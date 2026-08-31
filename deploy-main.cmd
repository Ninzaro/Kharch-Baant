@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-main.ps1" %*
