import { handleRequest } from "./handler";

export default {
  fetch(request, env, ctx): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareBindings>;
