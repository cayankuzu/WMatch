import {
  canViewProfileIdentityField,
  redactPeerReadReceipts,
} from "./privacy.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("profile identity privacy redacts peers but preserves self view", () => {
  const profileUserId = "11111111-1111-4111-8111-111111111111";

  assert(
    !canViewProfileIdentityField({
      fieldEnabled: false,
      profileUserId,
      viewerUserId: "22222222-2222-4222-8222-222222222222",
    }),
    "a peer must not see a disabled identity field",
  );
  assert(
    canViewProfileIdentityField({
      fieldEnabled: false,
      profileUserId,
      viewerUserId: profileUserId,
    }),
    "the owner must retain their own identity value",
  );
  assert(
    canViewProfileIdentityField({
      fieldEnabled: true,
      profileUserId,
      viewerUserId: null,
    }),
    "an enabled identity field remains public to authenticated flows",
  );
});

Deno.test("read receipt privacy redacts only the viewer's outgoing messages", () => {
  const currentUserId = "11111111-1111-4111-8111-111111111111";
  const peerUserId = "22222222-2222-4222-8222-222222222222";
  const messages = [
    { id: "outgoing", sender_id: currentUserId, read: true },
    { id: "incoming", sender_id: peerUserId, read: true },
  ];
  const redacted = redactPeerReadReceipts(messages, currentUserId, false);

  assert(redacted[0]?.read === false, "peer receipt must be hidden");
  assert(redacted[1]?.read === true, "the viewer's own read state is not peer data");
  assert(messages[0]?.read === true, "redaction must not mutate cached DB rows");
  assert(
    redactPeerReadReceipts(messages, currentUserId, true) === messages,
    "enabled receipts should preserve the original collection",
  );
});

