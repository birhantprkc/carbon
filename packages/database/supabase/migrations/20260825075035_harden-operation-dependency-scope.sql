-- Operation-dependency readiness must not be decided by another tenant's rows.
--
-- `jobOperationDependency` carries its own "companyId", but its FKs to
-- "jobOperation" and "job" are single-column, so Postgres only guarantees the
-- referenced row exists SOMEWHERE. A write path that pairs one company's id with
-- another company's job therefore produces rows attributed to the wrong tenant,
-- and all three readiness functions below counted them, because none filtered by
-- company at all.
--
-- The guard is deliberately `jo."companyId" = self."companyId"` — the two
-- operations in a dependency must belong to the same company — and NOT a filter
-- on `dep."companyId"`. That distinction is load-bearing: a mis-stamped row still
-- describes a real dependency between two real operations, so keying off the
-- operations keeps it counted, while keying off the row's own label would make it
-- vanish and flip a genuinely-waiting operation to Ready.
--
-- Each function is REPLACED WHOLE, so each body below is copied verbatim from its
-- own LATEST definition, with only the guard added:
--   check_operation_dependencies   <- 20250429130223_operation-dependencies.sql
--   set_initial_dependency_status  <- 20250429130223_operation-dependencies.sql
--   finish_job_operation           <- 20260417000300_storage-unit-recreate-dependents.sql
-- Taking finish_job_operation from the 2025 file instead would silently drop the
-- released-job guard (20251214180817) and the whole last-operation block that
-- completes the job, posts finished goods to inventory and notifies — do not.
--
-- See .ai/specs/2026-08-25-backup-durability.md Part 3.

CREATE OR REPLACE FUNCTION check_operation_dependencies(operation_id TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  incomplete_deps INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO incomplete_deps
  FROM "jobOperationDependency" dep
  JOIN "jobOperation" self ON self.id = dep."operationId"
  JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
  WHERE dep."operationId" = operation_id
    AND jo."companyId" = self."companyId"
    AND jo.status != 'Done';

  RETURN incomplete_deps = 0;
END;
$$;

-- Same guard. This is the one that can set an operation to Waiting, so without it
-- another tenant's row can hold a real operation back the moment its dependencies
-- are created.
CREATE OR REPLACE FUNCTION set_initial_dependency_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Don't update if operation is already Done or In Progress
  IF EXISTS (
    SELECT 1
    FROM "jobOperation"
    WHERE id = NEW."operationId"
      AND status IN ('Done', 'In Progress', 'Canceled')
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if there are any incomplete dependencies
  IF EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    JOIN "jobOperation" self ON self.id = dep."operationId"
    JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
    WHERE dep."operationId" = NEW."operationId"
      AND jo."companyId" = self."companyId"
      AND jo.status != 'Done'
  ) THEN
    -- Set status to Waiting if there are incomplete dependencies
    UPDATE "jobOperation"
    SET status = 'Waiting'
    WHERE id = NEW."operationId";
  ELSE
    -- Set status to Ready if all dependencies are done or there are no dependencies
    UPDATE "jobOperation"
    SET status = 'Ready'
    WHERE id = NEW."operationId";
  END IF;

  RETURN NEW;
END;
$$;

-- Body verbatim from 20260417000300; the ONLY change is the companyId guard in
-- the NOT EXISTS.
CREATE OR REPLACE FUNCTION finish_job_operation()
RETURNS TRIGGER AS $$
DECLARE
  job_status TEXT;
BEGIN
  -- Get current job status
  SELECT status INTO job_status FROM "job" WHERE id = NEW."jobId";

  -- Only process job completion logic if job is in active state (has been released)
  -- Jobs in Draft or Planned status should not trigger completion since dependencies
  -- are only created during scheduling
  IF job_status NOT IN ('Ready', 'In Progress', 'Paused') THEN
    RETURN NEW;
  END IF;

  -- Set endTime for all open production events
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = NEW.id AND "endTime" IS NULL;

  -- Find all operations that depend on this one and might be ready
  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = NEW.id
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    -- Check no other dependencies are incomplete
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2."companyId" = op."companyId"
      AND jo2.status != 'Done'
      AND jo2.id != NEW.id
  );

  -- Set the job operation status to Done
  NEW.status = 'Done';

  -- If this is the last operation, mark the job as Done
  IF is_last_job_operation(NEW.id) THEN
    DECLARE
      request_id TEXT;
      notify_url TEXT;
      api_url TEXT;
      anon_key TEXT;
      group_ids TEXT[];
      assigned_to TEXT;
      sales_order_id TEXT;
    BEGIN
      -- Get job details
      DECLARE
        job_item_id TEXT;
        job_quantity_to_produce INTEGER;
        job_location_id TEXT;
        job_storage_unit_id TEXT;
        job_quantity INTEGER;
        quantity_complete INTEGER;

      BEGIN


        SELECT "locationId", "storageUnitId", "quantity"
        INTO job_location_id, job_storage_unit_id, job_quantity
        FROM "job"
        WHERE "id" = NEW."jobId";

        -- Use full job quantity if quantityComplete is 0
        quantity_complete := CASE
          WHEN NEW."quantityComplete" = 0 THEN job_quantity
          ELSE NEW."quantityComplete"
        END;



        -- Get sales order info
        SELECT "salesOrderId" INTO sales_order_id FROM "job" WHERE "id" = NEW."jobId";

        IF sales_order_id IS NOT NULL THEN
          -- Make-to-order: just update job status with quantityComplete
          UPDATE "job"
          SET status = 'Completed',
              "completedDate" = NOW(),
              "quantityComplete" = quantity_complete,
              "updatedAt" = NOW(),
              "updatedBy" = NEW."updatedBy"
          WHERE id = NEW."jobId";
        ELSE
          -- Make-to-stock: update job status to Done and invoke edge function for inventory
          UPDATE "job"
          SET status = 'Completed',
              "completedDate" = NOW(),
              "updatedAt" = NOW(),
              "updatedBy" = NEW."updatedBy"
          WHERE id = NEW."jobId";

          -- Invoke the issue edge function to handle inventory
          PERFORM util.invoke_edge_function(
            name => 'issue',
            body => CASE
              WHEN job_storage_unit_id IS NOT NULL THEN
                jsonb_build_object(
                  'type', 'jobCompleteInventory',
                  'jobId', NEW."jobId",
                  'companyId', NEW."companyId",
                  'userId', NEW."updatedBy",
                  'quantityComplete', quantity_complete,
                  'locationId', job_location_id,
                  'shelfId', job_storage_unit_id
                )
              ELSE
                jsonb_build_object(
                  'type', 'jobCompleteInventory',
                  'jobId', NEW."jobId",
                  'companyId', NEW."companyId",
                  'userId', NEW."updatedBy",
                  'quantityComplete', quantity_complete,
                  'locationId', job_location_id
                )
            END
          );
        END IF;
      END;

      SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
      notify_url := api_url || '/functions/v1/trigger';

      SELECT "assignee", "salesOrderId" INTO assigned_to, sales_order_id FROM "job" WHERE "id" = NEW."jobId";

      IF sales_order_id IS NULL THEN
        SELECT "inventoryJobCompletedNotificationGroup" INTO group_ids FROM "companySettings" WHERE "id" = NEW."companyId";
      ELSE
        SELECT "salesJobCompletedNotificationGroup" INTO group_ids FROM "companySettings" WHERE "id" = NEW."companyId";
      END IF;

      IF assigned_to IS NOT NULL THEN
        SELECT array_append(group_ids, assigned_to) INTO group_ids;
      END IF;

      IF array_length(group_ids, 1) > 0 THEN
        SELECT net.http_post(
          notify_url,
          jsonb_build_object(
            'type', 'notify',
            'event', 'job-completed',
            'documentId', NEW."jobId",
            'companyId', NEW."companyId",
            'recipient', jsonb_build_object(
              'type', 'group',
              'groupIds', group_ids
            )
          )::jsonb,
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)
        ) INTO request_id;
      END IF;

    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
