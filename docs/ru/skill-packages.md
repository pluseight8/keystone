# Пакеты Skills

Skill в Keystone — устанавливаемый, версионируемый декларативный пакет процедур. В нём находятся нормализованный manifest, ограниченные инструкции, необязательные декларативные тесты, provenance источника и integrity-метаданные. Стабильный `skillId` не зависит от отображаемого имени.

Skill не является Plugin/Add-on и не содержит исполняемый runtime: он не может регистрировать Tool, запускать JavaScript/shell, устанавливать другой пакет или менять policy Keystone. Исполняемая граница остаётся прежней: `ToolIntent → ToolPolicy → confirmation → ToolExecutor`.

`SkillManifest` хранит identity/reference автора, semantic version, format version, instructions, tags, Tools/capabilities, data scopes, dependencies, compatibility, даты, SHA-256 manifest/content hashes и optional author signature. Display name автора не является authority. Imported, URL и P2P пакеты остаются untrusted.

Установка выполняется только явно: `parse → validate → integrity → dependencies → evaluation → user review → install`. Пользователь видит автора/источник, версию, Tools, capabilities, scopes, зависимости, предупреждения и integrity. Lifecycle: INSTALL, ENABLE, DISABLE, UPDATE, ROLLBACK, UNINSTALL. Новые permissions при update не появляются молча; rollback использует проверенную предыдущую revision.

`SkillPackageRegistry` хранит ограниченное durable состояние, а получение пакета через Chat/Space/FileObject не означает auto-install.

## Capture и extension boundary

Capture не является ambient extension hook. Skill, plugin, agent или webpage
не может подписаться на clipboard history, перечислять private tray, забирать
OS Share-In payload или route-ить captured item без explicit typed adapter,
текущего capability grant и owner confirmation. Capture provenance — untrusted
data и не даёт execution authority. Будущее capture extension обязано
оставаться bounded, preview-first и подчиняться тем же egress, data-class,
confirmation и audit rules.
