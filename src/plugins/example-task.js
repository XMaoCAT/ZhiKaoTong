import fs from 'node:fs';
import path from 'node:path';

export default {
  name: 'demo-import',
  version: '2026.10.20-01',
  async run(context) {
    const { task, filePath, resultsDir, updateProgress } = context;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    updateProgress(8, '开始处理');
    await sleep(400);

    updateProgress(25, filePath ? '读取上传文件' : '无附件，执行演示流程');
    await sleep(600);

    updateProgress(55, '数据校验与规则比对');
    await sleep(700);

    updateProgress(82, '生成结果文件');
    const result = {
      taskId: task.id,
      type: task.type,
      uploadId: task.upload_id,
      sourceFile: filePath || null,
      finishedAt: new Date().toISOString(),
      note: '演示插件处理结果（example-task.js 可热更新，替换为新版本无需重启核心服务）',
    };
    fs.writeFileSync(path.join(resultsDir, `${task.id}.json`), JSON.stringify(result, null, 2));

    await sleep(300);
    updateProgress(100, '处理完成');
    return { success: true, resultUrl: `/api/results/${task.id}` };
  },
};
