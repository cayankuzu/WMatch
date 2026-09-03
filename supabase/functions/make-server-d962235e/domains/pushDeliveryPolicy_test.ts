import {
  authorizeClaimedPushDelivery,
  prunePushTokenRegistry,
} from "./pushDeliveryPolicy.ts";
import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const rpcClient = (
  handler: (name: string, args: unknown) => { data: unknown; error: unknown },
) => ({
  rpc: (name: string, args: unknown) => Promise.resolve(handler(name, args)),
}) as unknown as SupabaseAdminClient;

Deno.test("push authorization suppresses a denied claimed job", async () => {
  const calls: string[] = [];
  const allowed = await authorizeClaimedPushDelivery(
    rpcClient((name) => {
      calls.push(name);
      return name === "authorize_push_delivery_job"
        ? {
          data: [{ authorized: false, reason: "relationship_blocked" }],
          error: null,
        }
        : { data: true, error: null };
    }),
    "11111111-1111-4111-8111-111111111111",
  );

  assert(!allowed, "denied job must not reach the provider");
  assert(
    calls.join(",") ===
      "authorize_push_delivery_job,complete_push_delivery_job",
    "suppression must be durably acknowledged",
  );
});

Deno.test("push authorization allows current jobs and prunes the token registry", async () => {
  const calls: string[] = [];
  const client = rpcClient((name) => {
    calls.push(name);
    return name === "authorize_push_delivery_job"
      ? { data: [{ authorized: true, reason: null }], error: null }
      : { data: 2, error: null };
  });

  assert(
    await authorizeClaimedPushDelivery(
      client,
      "22222222-2222-4222-8222-222222222222",
    ),
    "authorized job must proceed",
  );
  await prunePushTokenRegistry(client);
  assert(
    calls.join(",") ===
      "authorize_push_delivery_job,prune_device_push_tokens",
    "drain must run bounded token cleanup",
  );
});

