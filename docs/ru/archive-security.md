# Безопасность архивов

Архив сначала инспектируется, и только затем строится bounded extraction plan. Mandatory defaults ограничивают entry count, expanded bytes, размер записи, compression ratio, nesting depth и path length; пользователь может только ужесточить их.

ZIP central directory и TAR headers разбираются без unbounded expansion. Отклоняются absolute/drive/UNC paths, `..`, device paths, дубликаты и case-folded/confusable names, symlinks и hard-link-like entries. Destination генерируется Keystone; имя архива не становится OS path.

Nested archives сохраняют `ContentProvenanceChain`. Bombs, malformed headers, recursion и budget violations остаются в quarantine. Member не выполняется и не устанавливается автоматически.
