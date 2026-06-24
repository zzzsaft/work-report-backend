import { createApp } from "./app.js";
import { config } from "./lib/config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`work-report-backend listening on http://localhost:${config.port}`);
});
