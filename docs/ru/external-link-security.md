# Безопасность внешних ссылок

Плагин запрашивает navigation через `ExternalLinkGateway`, а не открывает URL напрямую. Разрешены только bounded HTTP(S); unsafe scheme, control chars, malformed и local/metadata destinations отклоняются. Unknown host явно остаётся внешним.
