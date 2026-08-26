# Browser Artifacts

Результат извлечения — единый `BrowserArtifact`, а не копия данных для
браузера. Он содержит URL/origin источника, ограниченные extracted data и
citations, timestamp, page revision, ссылки на screenshot/file, provenance
session/tab/owner, SHA-256 integrity, data class и маркер доверия
`UNTRUSTED`.

Artifact сохраняет недоверенный статус страницы. Citation — ссылка на
наблюдение, а не утверждение, что сайт авторитетен. При изменении revision
страницу следует наблюдать заново.

`BrowserArtifactTaskGraphAdapter` переводит artifact в существующий structured
TaskGraph artifact, сохраняя ID, file references, data class, source kind,
integrity и provenance. Private external artifact отклоняется. Research,
Analysis и Agent Bot получают результат через существующий Task Graph, без
нового browser-протокола.

Screenshot и downloads — только ссылки; workspace не сохраняет текст страницы
или секреты. Quota, pinning, availability и проверка content остаются в
существующих Keystone File/content слоях.
