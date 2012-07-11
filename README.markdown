nodeftpd - a simple FTP server written in node.js
====

Fork of https://github.com/alanszlosek/nodeftpd

The old README is in OldREADME.markdown

Info
----

This FTP server:

* Abstracts out the `fs` module, so you can pass in any implemetation of file system operations you like.
* Provides hooks for handling uploads, etc.
* Supports TLS with explicit AUTH (though this is still a little buggy in places).