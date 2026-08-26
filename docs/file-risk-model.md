# File risk model

`FileTypeDetector` combines extension and sender MIME hints with magic bytes and structural evidence. The actual type wins. A PE/ELF/Mach-O header named `cat.jpg` is a mismatch and `CRITICAL` executable risk. Script shebangs, interpreter-like formats, installers, bundles and macro-capable documents are high risk by default.

Risk classes are `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` and `UNKNOWN`; executable risk and container risk are independent fields. A clean scanner result does not lower executable risk to an execution permission. Missing or failing scanners stay unknown/fail-closed. Content Safety labels are never malware reputation authority.

Metrics are local-only: quarantine count, type mismatches, parser failures, archive rejects, quota rejects, scanner results, owner releases and preview failures.
