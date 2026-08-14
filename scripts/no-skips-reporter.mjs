// MIT License — Copyright (c) 2026 Mateus Gaio
export default class NoSkipsReporter {
  onBegin(_config, suite) {
    this.suite = suite;
  }

  onEnd() {
    const skipped = this.suite.allTests().filter((test) => test.outcome() === "skipped");
    if (!skipped.length) return;

    console.error(`\nE2E bloqueado: ${skipped.length} teste(s) foram ignorado(s).`);
    for (const test of skipped) console.error(`- ${test.titlePath().join(" › ")}`);
    process.exitCode = 1;
  }
}
