ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_client_request_id_length_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_client_request_id_length_check
  CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 120);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_request_id
  ON public.messages(sender_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
