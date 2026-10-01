export async function prepareOfflineShell(): Promise<void> {
  if (!("serviceWorker" in navigator))
    throw new Error("이 브라우저는 Offline 화면 저장을 지원하지 않습니다.");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw new Error("Offline 화면을 준비하지 못했습니다.");
  const urls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => new URL(url).pathname.startsWith("/_next/static/"));
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Offline 화면 준비 시간이 초과되었습니다."));
      }, 30000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ready === true) resolve();
      else reject(new Error("Offline 정적 파일을 저장하지 못했습니다."));
    };
    worker.postMessage({ type: "CACHE_ASSETS", urls }, [channel.port2]);
  });
}
