import { writeFileSync } from "fs";
import { buildTasks, datasetHash } from "../lib/tasks";
const tasks = buildTasks();
const hash = datasetHash(tasks);
writeFileSync("data/tasks.json", JSON.stringify({ hash, created: new Date().toISOString(), tasks }, null, 1));
const by: Record<string, any> = {};
for (const t of tasks) { const k = t.spec_id; by[k] ??= { success: 0, infeasible: 0, invalid_input: 0, hard: 0 }; by[k][t.truth.expected_status]++; if (t.hard) by[k].hard++; }
console.log("hash", hash, "n", tasks.length); console.table(by);
for (const t of tasks.filter(t=>["P01","P06","P12","P13"].includes(t.spec_id)).slice(0,40)) console.log(t.id, t.split, t.text, JSON.stringify(t.truth));
