@echo off
setlocal
title Installation de RR FX

rem Installe le panneau RR FX pour Premiere Pro : copie le dossier RRFX dans les
rem extensions Adobe et autorise les extensions non signees.
rem Pas de parentheses dans les messages : elles cassent les blocs des fichiers .bat.

set "SRC=%~dp0RRFX"
set "DEST=%APPDATA%\Adobe\CEP\extensions\RRFX"
set "LOG=%~dp0installation-rrfx.log"

if not exist "%SRC%\CSXS\manifest.xml" goto no_src

echo Installation de RR FX dans :
echo   "%DEST%"
echo.

for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f > nul 2>&1

if exist "%DEST%" rmdir /s /q "%DEST%"
rem Ancien nom du plugin : le panneau CutFX est retire pour ne pas l'avoir en double.
if exist "%APPDATA%\Adobe\CEP\extensions\CutFX" rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\CutFX"
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP > "%LOG%" 2>&1
if %ERRORLEVEL% GEQ 8 goto failed
if not exist "%DEST%\CSXS\manifest.xml" goto failed

echo Termine. Redemarre Premiere Pro, puis : Fenetre ^> Extensions ^> RR FX
goto end

:failed
echo La copie a echoue. Detail enregistre dans :
echo   %LOG%
echo Ferme Premiere Pro puis relance ce script.
echo Si ca persiste, fais une capture de cette fenetre et envoie-la a @robin.rahoual.
goto end

:no_src
echo Le dossier RRFX est introuvable a cote de ce script.
echo Decompresse tout le pack avant de lancer l'installation.
goto end

:end
echo.
pause
