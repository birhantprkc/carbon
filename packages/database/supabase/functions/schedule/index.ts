import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import type {
  SchedulingDirection,
  SchedulingMode,
} from "../lib/scheduling/types.ts";
import { requirePermissions } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  jobId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  mode: z.enum(["initial", "reschedule"]).default("initial"),
  direction: z.enum(["backward", "forward"]).default("backward"),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    const { jobId, companyId, userId, mode, direction } = validatedPayload;

    console.info(`🔰 Starting ${mode} scheduling for job ${jobId}`);
    console.info(`📋 Direction: ${direction}`);

    const client = await requirePermissions(req, companyId, userId, { update: "production" });

    // `requirePermissions` proved the caller may update production in
    // `companyId`. It did NOT prove `jobId` belongs to that company — both
    // arrive in the same payload, from callers that pass a URL segment straight
    // through on a service-role client. Without this, a request pairing one
    // company's id with another company's job rebuilds the victim's dependency
    // rows stamped with the caller's `companyId`.
    // See .ai/specs/2026-08-25-backup-durability.md Part 3.
    const job = await db
      .selectFrom("job")
      .select(["id", "companyId"])
      .where("id", "=", jobId)
      .executeTakeFirst();

    // 404, not 403: a job in another company must be indistinguishable from a
    // job that does not exist.
    if (!job || job.companyId !== companyId) {
      return errorResponse("Job not found in this company", 404);
    }

    const engine = new SchedulingEngine({
      client,
      db,
      jobId,
      companyId,
      userId,
      mode: mode as SchedulingMode,
      direction: direction as SchedulingDirection,
    });

    const result = await engine.run();

    console.info(`✅ Scheduling complete:`);
    console.info(`   Operations scheduled: ${result.operationsScheduled}`);
    console.info(`   Conflicts detected: ${result.conflictsDetected}`);
    console.info(
      `   Work centers affected: ${result.workCentersAffected.length}`
    );
    console.info(`   Assembly depth: ${result.assemblyDepth}`);

    return jsonResponse({
      ...result,
    });
  } catch (error) {
    console.error(
      `❌ Scheduling failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return errorResponse(error, 500);
  }
});
