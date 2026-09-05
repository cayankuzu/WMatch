import type { SupabaseAdminClient } from "../sharedMiddleware.ts";

export const authorizeClaimedPushDelivery = async (
  supabase: SupabaseAdminClient,
  eventId: string,
) => {
  const { data: authorizationRows, error: authorizationError } =
    await supabase.rpc("authorize_push_delivery_job", { p_event_id: eventId });

  if (authorizationError) throw authorizationError;
  const authorization = Array.isArray(authorizationRows)
    ? authorizationRows[0]
    : authorizationRows;

  if (authorization?.authorized) return true;
  if (
    !authorization?.reason ||
    ["delivery_state_changed", "event_missing"].includes(authorization.reason)
  ) return false;

  const { data: recorded, error: completionError } = await supabase.rpc(
    "complete_push_delivery_job",
    {
      p_event_id: eventId,
      p_status: "suppressed",
      p_error: authorization.reason,
    },
  );

  if (completionError) throw completionError;
  if (!recorded) throw new Error("push_suppression_not_persisted");
  return false;
};

export const prunePushTokenRegistry = async (
  supabase: SupabaseAdminClient,
) => {
  const { error } = await supabase.rpc("prune_device_push_tokens", {});
  if (error) throw error;
};

