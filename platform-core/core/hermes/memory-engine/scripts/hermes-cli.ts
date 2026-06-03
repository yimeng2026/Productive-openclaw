import { HermesEngine } from '../src/HermesEngine';

async function main() {
  const hermes = new HermesEngine({
    scanIntervalMs: 60000,
    patternThreshold: 2,
    fossilizeTrigger: 'manual',
    knowledgeGraphPath: './data/knowledge-graph.jsonl',
    skillOutputDir: './skills/auto-forged',
    codeGrowthWhitelist: ['mega/modules', 'mega/services', 'mega/apps'],
  });

  console.log('=== Hermes v2 Memory-to-Structure Cycle ===');
  await hermes.start();

  // 运行一个周期
  const state = await hermes.runCycle();
  console.log('周期完成:', state);

  // Swarm 状态
  const swarmStats = hermes.getSwarmStats();
  console.log('Swarm 状态:', swarmStats);

  hermes.stop();
}

main().catch(console.error);
