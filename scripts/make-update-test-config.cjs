// 업데이트 흐름 시험용 electron-builder 설정을 만든다.
// package.json 의 build 설정을 그대로 가져오되, 업데이트 주소만 로컬 서버(generic)로 바꾸고 출력 폴더를 나눈다.
//
// 사용법: node scripts/make-update-test-config.cjs <업데이트 서버 주소> <출력 폴더> <설정 파일> <버전>
// (electron-builder 는 --config 파일과 -c.extraMetadata… 옵션을 함께 쓰면 충돌하므로 버전도 설정 파일에 넣는다)
const { readFileSync, writeFileSync } = require("node:fs");
const [url, outDir, file, version] = process.argv.slice(2);
if (!url || !outDir || !file || !version) {
  console.error("사용법: node scripts/make-update-test-config.cjs <서버 주소> <출력 폴더> <설정 파일> <버전>");
  process.exit(2);
}
const build = JSON.parse(readFileSync("package.json", "utf8")).build;
build.directories = { ...build.directories, output: outDir };
build.publish = [{ provider: "generic", url }];
build.extraMetadata = { ...build.extraMetadata, version };
writeFileSync(file, JSON.stringify(build, null, 2));
console.log(`설정 생성: ${file} (버전 ${version}, 출력 ${outDir}, 업데이트 주소 ${url})`);
