!ifndef BUILD_UNINSTALLER
  Var noctuneExistingInstall
  Var noctuneManualUpdate
  Var noctuneInstalledDirectory
  Var noctuneAudioOptIn

  ; Conditions use a snapshot of the original flags plus installation detection.
  ; This preserves update semantics for shortcuts, shutdown and app relaunch.
  !undef isUpdated
  !define isUpdated `$noctuneExistingInstall == "1"`
  !undef isForceRun
  !define isForceRun `$noctuneManualUpdate == "1"`

  !macro customInit
    StrCpy $noctuneExistingInstall "0"
    StrCpy $noctuneManualUpdate "0"
    ; Only an explicit action in settings grants audio registration on updates.
    ReadRegDWORD $noctuneAudioOptIn HKCU "Software\Noctune" "AudioFileAssociationsEnabled"
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
!macro NoctuneRegisterAudioHandler ROOT EXT
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Audio.${EXT}" "" "Noctune ${EXT} audio"
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Audio.${EXT}\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Audio.${EXT}\shell\open" "" "Открыть в Noctune"
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Audio.${EXT}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
!macroend

!macro NoctuneRegisterAudio ROOT EXT
  !insertmacro NoctuneRegisterAudioHandler ${ROOT} ${EXT}
  WriteRegNone ${ROOT} "Software\Classes\.${EXT}\OpenWithProgids" "Noctune.Audio.${EXT}"
  WriteRegStr ${ROOT} "Software\Noctune\Capabilities\FileAssociations" ".${EXT}" "Noctune.Audio.${EXT}"
  ; Remove the previous single command when upgrading to a cascading menu.
  DeleteRegKey ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune"
  WriteRegStr ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "MUIVerb" "Noctune"
  WriteRegStr ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune" "ExtendedSubCommandsKey" "Noctune.Commands"
!macroend

!macro NoctuneCommand ROOT KEY LABEL ACTION
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Commands\shell\${KEY}" "MUIVerb" "${LABEL}"
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Commands\shell\${KEY}" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Commands\shell\${KEY}" "MultiSelectModel" "Player"
  WriteRegStr ${ROOT} "Software\Classes\Noctune.Commands\shell\${KEY}\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --noctune-action=${ACTION} -- $\"%1$\"'
!macroend

!macro NoctuneUnregisterAudio ROOT EXT
  DeleteRegKey ${ROOT} "Software\Classes\Noctune.Audio.${EXT}"
  DeleteRegValue ${ROOT} "Software\Classes\.${EXT}\OpenWithProgids" "Noctune.Audio.${EXT}"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune"
  DeleteRegValue ${ROOT} "Software\Noctune\Capabilities\FileAssociations" ".${EXT}"
!macroend

!macro NoctuneRemoveLegacyAudio ROOT EXT
  ; Preserve an existing explicit default, but remove automatically added menus.
  ; Never write or delete UserChoice or another application's registration.
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.${EXT}\UserChoice" "ProgId"
  ReadRegStr $R7 HKCR ".${EXT}" ""
  ${If} $R8 != "Noctune.Audio.${EXT}"
  ${AndIf} $R7 != "Noctune.Audio.${EXT}"
    DeleteRegKey ${ROOT} "Software\Classes\Noctune.Audio.${EXT}"
  ${Else}
    ; The previous uninstaller may have removed the selected ProgID already.
    ; Restore only that handler, without adding audio menus or new defaults.
    !insertmacro NoctuneRegisterAudioHandler HKCU ${EXT}
  ${EndIf}
  DeleteRegValue ${ROOT} "Software\Classes\.${EXT}\OpenWithProgids" "Noctune.Audio.${EXT}"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\Noctune"
  DeleteRegValue ${ROOT} "Software\Noctune\Capabilities\FileAssociations" ".${EXT}"
!macroend

!macro NoctuneRemoveAudio ROOT
  !insertmacro NoctuneRemoveLegacyAudio ${ROOT} "mp3"
  !insertmacro NoctuneRemoveLegacyAudio ${ROOT} "wav"
  !insertmacro NoctuneRemoveLegacyAudio ${ROOT} "ogg"
  !insertmacro NoctuneRemoveLegacyAudio ${ROOT} "m4a"
  !insertmacro NoctuneRemoveLegacyAudio ${ROOT} "flac"
  DeleteRegKey ${ROOT} "Software\Classes\Noctune.Commands"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Addon" "" "Расширение Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Addon\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Addon\shell\open" "" "Установить или обновить расширение Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Addon\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.noctaddon\OpenWithProgids" "Noctune.Addon"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities\FileAssociations" ".noctaddon" "Noctune.Addon"
  ReadRegStr $R9 HKCR ".noctaddon" ""
  ${If} $R9 == ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\.noctaddon" "" "Noctune.Addon"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctaddon\shell\Noctune" "" "Установить или обновить расширение Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctaddon\shell\Noctune" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctaddon\shell\Noctune\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Theme" "" "Тема Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Theme\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Theme\shell\open" "" "Добавить тему в Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Noctune.Theme\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.noctheme\OpenWithProgids" "Noctune.Theme"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities\FileAssociations" ".noctheme" "Noctune.Theme"
  ReadRegStr $R9 HKCR ".noctheme" ""
  ${If} $R9 == ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\.noctheme" "" "Noctune.Theme"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctheme\shell\Noctune" "" "Добавить тему в Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctheme\shell\Noctune" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctheme\shell\Noctune\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationName" "Noctune"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationDescription" "Noctune music player"
  WriteRegStr SHELL_CONTEXT "Software\Noctune\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Noctune" "Software\Noctune\Capabilities"
  ${If} $noctuneAudioOptIn == 1
    WriteRegStr HKCU "Software\Noctune\Capabilities" "ApplicationName" "Noctune"
    WriteRegStr HKCU "Software\Noctune\Capabilities" "ApplicationDescription" "Noctune music player"
    WriteRegStr HKCU "Software\Noctune\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
    WriteRegStr HKCU "Software\RegisteredApplications" "Noctune" "Software\Noctune\Capabilities"
    !insertmacro NoctuneCommand HKCU "01play" "Воспроизвести" "play"
    !insertmacro NoctuneCommand HKCU "02new" "Открыть в новом плейлисте" "new-playlist"
    !insertmacro NoctuneCommand HKCU "03add" "Добавить в плейлист" "add-playlist"
    !insertmacro NoctuneCommand HKCU "04queue" "Добавить в очередь" "enqueue"
    !insertmacro NoctuneRegisterAudio HKCU "mp3"
    !insertmacro NoctuneRegisterAudio HKCU "wav"
    !insertmacro NoctuneRegisterAudio HKCU "ogg"
    !insertmacro NoctuneRegisterAudio HKCU "m4a"
    !insertmacro NoctuneRegisterAudio HKCU "flac"
    WriteRegDWORD HKCU "Software\Noctune" "AudioFileAssociationsEnabled" 1
  ${Else}
    !insertmacro NoctuneRemoveAudio SHELL_CONTEXT
    !insertmacro NoctuneRemoveAudio HKCU
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Noctune.Addon"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.noctaddon\OpenWithProgids" "Noctune.Addon"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.noctaddon\OpenWithProgids"
  ReadRegStr $R9 SHELL_CONTEXT "Software\Classes\.noctaddon" ""
  ${If} $R9 == "Noctune.Addon"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.noctaddon" ""
  ${EndIf}
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.noctaddon"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctaddon\shell\Noctune"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Noctune.Theme"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.noctheme\OpenWithProgids" "Noctune.Theme"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.noctheme\OpenWithProgids"
  ReadRegStr $R9 SHELL_CONTEXT "Software\Classes\.noctheme" ""
  ${If} $R9 == "Noctune.Theme"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.noctheme" ""
  ${EndIf}
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.noctheme"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.noctheme\shell\Noctune"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Noctune.Commands"
  !insertmacro NoctuneUnregisterAudio SHELL_CONTEXT "mp3"
  !insertmacro NoctuneUnregisterAudio SHELL_CONTEXT "wav"
  !insertmacro NoctuneUnregisterAudio SHELL_CONTEXT "ogg"
  !insertmacro NoctuneUnregisterAudio SHELL_CONTEXT "m4a"
  !insertmacro NoctuneUnregisterAudio SHELL_CONTEXT "flac"
  !insertmacro NoctuneUnregisterAudio HKCU "mp3"
  !insertmacro NoctuneUnregisterAudio HKCU "wav"
  !insertmacro NoctuneUnregisterAudio HKCU "ogg"
  !insertmacro NoctuneUnregisterAudio HKCU "m4a"
  !insertmacro NoctuneUnregisterAudio HKCU "flac"
  DeleteRegKey HKCU "Software\Classes\Noctune.Commands"
  DeleteRegValue HKCU "Software\Noctune" "AudioFileAssociationsEnabled"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Noctune"
  DeleteRegKey HKCU "Software\Noctune\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\Noctune"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Noctune"
  DeleteRegKey SHELL_CONTEXT "Software\Noctune\Capabilities"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Noctune"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
