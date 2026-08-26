# Linux native runtime

Linux native runtime проверяет реальные scoped filesystem handles, child process plugin host,
lifecycle invalidation и framed local TCP transport. Это process separation,
но не безусловное заявление о seccomp, namespaces или полном OS sandbox.
