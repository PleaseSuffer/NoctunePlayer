!ifndef BUILD_UNINSTALLER
  Var noctuneExistingInstall
  Var noctuneManualUpdate
  Var noctuneInstalledDirectory

  ; Conditions use a snapshot of the original flags plus installation detection.
  ; This preserves update semantics for shortcuts, shutdown and app relaunch.
  !undef isUpdated
  !define isUpdated `$noctuneExistingInstall == "1"`
  !undef isForceRun
  !define isForceRun `$noctuneManualUpdate == "1"`

  !macro customInit
    StrCpy $noctuneExistingInstall "0"
    StrCpy $noctuneManualUpdate "0"
    ${StdUtils.TestParameter} $R9 "updated"
    ${If} $R9 == "true"
      StrCpy $noctuneExistingInstall "1"
    ${EndIf}
    ${StdUtils.TestParameter} $R9 "force-run"
    ${If} $R9 == "true"
      StrCpy $noctuneManualUpdate "1"
    ${EndIf}
    ; initMultiUser has already selected the existing user/machine scope.
    ReadRegStr $noctuneInstalledDirectory SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $noctuneInstalledDirectory != ""
    ${AndIf} ${FileExists} "$noctuneInstalledDirectory\${APP_EXECUTABLE_FILENAME}"
      ${IfNot} ${isUpdated}
      ${AndIfNot} ${Silent}
        StrCpy $noctuneManualUpdate "1"
      ${EndIf}
      StrCpy $noctuneExistingInstall "1"
      StrCpy $INSTDIR $noctuneInstalledDirectory
      SetSilent silent
    ${EndIf}
  !macroend
!endif

; Register handlers without changing the user's existing default application.
!macro NoctuneRegisterAudio EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Audio.${EXT}" "" "Noctune ${EXT} audio"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Audio.${EXT}\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Audio.${EXT}\shell\open" "" "Открыть в Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Audio.${EXT}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "Noctune.Audio.${EXT}"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities\FileAssociations" ".${EXT}" "Noctune.Audio.${EXT}"
  ; Remove the previous single command when upgrading to a cascading menu.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "MUIVerb" "Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "ExtendedSubCommandsKey" "Noctune.Commands"
!macroend

!macro NoctuneCommand KEY LABEL ACTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Commands\shell\${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Commands\shell\${KEY}" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Commands\shell\${KEY}" "MultiSelectModel" "Player"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Commands\shell\${KEY}\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --noctune-action=${ACTION} -- $\"%1$\"'
!macroend

!macro NoctuneUnregisterAudio EXT
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Noctune.Audio.${EXT}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "Noctune.Audio.${EXT}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune"
!macroend

!macro customInstall
  !insertmacro NoctuneCommand "01play" "Воспроизвести" "play"
  !insertmacro NoctuneCommand "02new" "Открыть в новом плейлисте" "new-playlist"
  !insertmacro NoctuneCommand "03add" "Добавить в плейлист" "add-playlist"
  !insertmacro NoctuneCommand "04queue" "Добавить в очередь" "enqueue"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationName" "Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationDescription" "Noctune music player"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Noctune" "Software\Noctune\Capabilities"
  !insertmacro NoctuneRegisterAudio "mp3"
  !insertmacro NoctuneRegisterAudio "wav"
  !insertmacro NoctuneRegisterAudio "ogg"
  !insertmacro NoctuneRegisterAudio "m4a"
  !insertmacro NoctuneRegisterAudio "flac"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Noctune.Commands"
  !insertmacro NoctuneUnregisterAudio "mp3"
  !insertmacro NoctuneUnregisterAudio "wav"
  !insertmacro NoctuneUnregisterAudio "ogg"
  !insertmacro NoctuneUnregisterAudio "m4a"
  !insertmacro NoctuneUnregisterAudio "flac"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Noctune"
  DeleteRegKey SHELL_CONTEXT "Software\Noctune\Capabilities"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Noctune"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
