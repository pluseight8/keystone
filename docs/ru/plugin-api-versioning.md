# Версионирование Plugin API

API version (сейчас `1`) — протокольный контракт, а не версия приложения. Плагин объявляет minimum/maximum/preferred и features (`search.v1`). `negotiate()` возвращает выбранную версию или явную несовместимость; silent compatibility нет. Неизвестные features и старые revision/session отклоняются.
