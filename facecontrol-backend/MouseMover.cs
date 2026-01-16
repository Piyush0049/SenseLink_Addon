// MouseMover.cs
using System;
using System.Runtime.InteropServices;

class MouseMover
{
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);
    
    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    
    const int MOUSEEVENTF_LEFTDOWN = 0x0002;
    const int MOUSEEVENTF_LEFTUP = 0x0004;
    const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const int MOUSEEVENTF_RIGHTUP = 0x0010;
    
    static void Main(string[] args)
    {
        if (args.Length < 1) return;
        
        string action = args[0].ToLower();
        
        if (action == "move" && args.Length >= 3)
        {
            int x = int.Parse(args[1]);
            int y = int.Parse(args[2]);
            SetCursorPos(x, y);
            Console.WriteLine("OK");
        }
        else if (action == "click")
        {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            Console.WriteLine("OK");
        }
        else if (action == "rightclick")
        {
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
            Console.WriteLine("OK");
        }
        else if (action == "mousedown")
        {
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Console.WriteLine("OK");
        }
        else if (action == "mouseup")
        {
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            Console.WriteLine("OK");
        }
    }
}
