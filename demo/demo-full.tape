# aspens full demo
# Run with: vhs demo-full.tape

Output demo-full.gif
Set Width 1200
Set Height 1200
Set FontSize 20
Set TypingSpeed 70ms
Set Padding 30
Set Theme "Catppuccin Mocha"

# 1. Scan
Type "aspens scan ~/tutorkit"
Sleep 500ms
Enter
Sleep 6s

# 2. Doc init (interactive)
Type "aspens doc init --dry-run --verbose ~/tutorkit"
Sleep 500ms
Enter
Sleep 5s

# Mode prompt — "One domain at a time" (arrow down)
Down
Sleep 200ms
Enter
Sleep 4s

# Domain picker — select a few
Space
Sleep 300ms
Down
Sleep 200ms
Space
Sleep 300ms
Down
Sleep 200ms
Space
Sleep 300ms
Enter
Sleep 6s

# Spinner running — show briefly then kill
Sleep 5s
Ctrl+C
Sleep 4s

# 3. Agent library
Type "aspens add agent --list"
Sleep 500ms
Enter
Sleep 5s
