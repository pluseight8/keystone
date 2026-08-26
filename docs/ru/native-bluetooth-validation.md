# Проверка native Bluetooth

Linux probe обнаруживает реальный controller, но не публикует его адрес или имя
как социальную Identity. Scan/advertise ограничены временем и policy. Наличие
controller не означает проверенный peer exchange; BLE Coded PHY не форсируется.
