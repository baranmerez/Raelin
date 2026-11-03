; Extra registration Tauri's file association does not write: without these, Raelin is
; missing from Explorer's "Open with" list. Per-user install, so everything is in HKCU.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Applications\raelin.exe" "FriendlyAppName" "Raelin"
  WriteRegStr HKCU "Software\Classes\Applications\raelin.exe\SupportedTypes" ".rli" ""
  WriteRegStr HKCU "Software\Classes\Applications\raelin.exe\DefaultIcon" "" '"$INSTDIR\raelin.exe",0'
  WriteRegStr HKCU "Software\Classes\Applications\raelin.exe\shell\open\command" "" '"$INSTDIR\raelin.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.rli\OpenWithProgids" "Raelin" ""
  ; Tell Explorer the associations changed so the list updates without a sign-out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Applications\raelin.exe"
  DeleteRegValue HKCU "Software\Classes\.rli\OpenWithProgids" "Raelin"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
