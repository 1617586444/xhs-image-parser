import { Container, getContainer } from "@cloudflare/containers";

export class XhsParserContainer extends Container {
  defaultPort = 8876;
  sleepAfter = "10m";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session") || "default";
    const container = getContainer(env.XHS_PARSER_CONTAINER, sessionId);
    return container.fetch(request);
  },
};
