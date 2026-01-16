Set WshShell = WScript.CreateObject("WScript.Shell")
Set args = WScript.Arguments

If args.Count >= 2 Then
    x = CInt(args(0))
    y = CInt(args(1))
    
    Set objShell = CreateObject("Shell.Application")
    
    ' Use SendKeys workaround - move mouse via AutoIt-style COM
    Set oAutoIt = CreateObject("AutoItX3.Control")
    oAutoIt.MouseMove x, y, 0
End If
