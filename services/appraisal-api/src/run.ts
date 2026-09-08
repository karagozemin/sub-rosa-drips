import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.appraisal-api.src.run");
import { configFromEnv } from "./config.js";
import { buildAppraisalServer } from "./server.js";

const config = configFromEnv();
const server = await buildAppraisalServer(config);
server.listen(config.port, () => {
  diagnostics.info("sub-rosa-appraisal-api-on", `sub-rosa appraisal API on :${config.port} — POST /appraise costs ${config.price} on ${config.network}`);
  diagnostics.info("asset", `  asset ${config.asset}`);
  diagnostics.info("payto", `  payTo ${config.payTo}`);
});
