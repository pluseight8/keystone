Pod::Spec.new do |s|
  s.name           = 'KeystoneBrowser'
  s.version        = '0.1.0'
  s.summary        = 'Keystone secure browser engine bridge'
  s.description    = 'Expo module backed by WKWebView on iOS.'
  s.author         = 'Keystone contributors'
  s.homepage       = 'https://github.com/keystone-app/keystone'
  s.license        = { :type => 'AGPL-3.0-or-later' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
