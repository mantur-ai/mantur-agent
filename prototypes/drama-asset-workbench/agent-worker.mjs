/** Isolated Agent transport simulator with separately observable acceptance and execution. */
import { rewriteFixture } from './controlled-agent.mjs';
self.onmessage = ({ data: request }) => {
  self.postMessage({ type: 'accepted', requestId: request.id, targets: request.targets.map(({ id, attempt }) => ({ id, attempt })) });
  setTimeout(() => {
    self.postMessage({ type: 'proposal', requestId: request.id, results: rewriteFixture(request) });
  }, 700);
};
