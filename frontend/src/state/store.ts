/**
 * Data stays OFF the render path: the socket writes here; the render loop reads `latest`
 * once per frame. A burst of messages can never cause more than one scene update per frame.
 */
import type { ConnState } from "../net/client";
import type { Snapshot } from "../net/protocol";

export const store: { latest: Snapshot | null; conn: ConnState } = {
  latest: null,
  conn: "connecting",
};
