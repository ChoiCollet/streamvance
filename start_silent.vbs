Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 3000번 포트 확인 후 없으면 백그라운드로 server.py 실행
cmd = "cmd /c cd /d """ & currentDir & """ && netstat -ano | findstr "":3000 "" | findstr ""LISTENING"" || start /b python server.py"
WshShell.Run cmd, 0, False

' 1.5초 후 브라우저 열기
WScript.Sleep 1500
WshShell.Run "http://localhost:3000", 1, False
