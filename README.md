# donga
파일 정리 도구

# Features
 - 파일 탐색 및 자동 분류
 - 파일 정리 및 복구
 - 중복 파일 탐지 및 관리

# DORA metrics
GitHub Actions workflow는 최근 30일의 GitHub 배포 및 병합된 PR을 기준으로 Lead Time, Deployment Frequency, MTTR, Change Failure Rate를 계산해 workflow summary에 표시하고 `dora-metrics.json` 파일로 생성해 90일간 보관하는 Artifact로 업로드합니다. JSON에는 생성/집계 기간, 지표 값 및 표본 수가 포함됩니다. MTTR은 실패 또는 오류 배포 후 동일 환경에 발생한 다음 성공 배포까지의 시간이며, 아직 복구되지 않은 실패는 평균에서 제외됩니다.

매주 월요일 00:00 UTC에 별도 Job이 최근 7일의 지표를 다시 계산해 주간 요약 Issue를 생성하거나 같은 기간의 기존 Issue를 갱신합니다. 주간 데이터도 `weekly-dora-metrics.json` Artifact로 90일간 보관하며, Issue에서 실행별 Artifact에 접근할 수 있습니다.
