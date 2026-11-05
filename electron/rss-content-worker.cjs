const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

if (isMainThread) {
  function run(operation, data) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: { operation, data } });
      let received = false, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        worker.terminate();
        finish(new Error('RSS article processing timed out.'));
      }, 15000);
      timer.unref();
      worker.on('message', result => {
        received = true;
        if (result.error) finish(new Error(result.error));
        else finish(null, result.value);
      });
      worker.on('error', error => finish(error));
      worker.on('exit', code => {
        if (code !== 0) finish(new Error(`RSS content worker exited with status ${code}.`));
        else if (!received) finish(new Error('RSS content worker returned no result.'));
      });
    });
  }
  module.exports = { run };
} else {
  const { pageIsPaywalled, readerContent, normalizeExtractedArticle, articleImage } = require('./rss-engine.cjs');
  try {
    const { operation, data } = workerData;
    let value;
    if (operation === 'paywall') value = pageIsPaywalled(data.html);
    else if (operation === 'image') value = articleImage(data.html, data.url);
    else if (operation === 'readability') value = readerContent(data.html, data.url);
    else if (operation === 'normalize') value = normalizeExtractedArticle(data.result, data.html, data.url);
    else throw new Error('Unknown RSS content-worker operation.');
    parentPort.postMessage({ value });
  } catch (error) {
    parentPort.postMessage({ error: String(error.message || error) });
  } finally {
    parentPort.close();
  }
}
