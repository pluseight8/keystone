# External link security

Plugins request navigation through `ExternalLinkGateway`; they cannot open URLs directly or suppress the warning. Only bounded HTTP(S) URLs are accepted. Unsafe schemes, control characters, malformed URLs and local/metadata destinations are rejected. Unknown hosts remain visibly external and the Core shell owns confirmation/navigation.
