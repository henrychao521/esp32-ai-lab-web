# 根據 AI 視覺手勢辨識結果切換螢幕卡通表情
current_gesture = "none"

@lab.on_cmd
def on_cmd(cmd):
    global current_gesture
    if cmd.get("op") == "vision" and cmd.get("mode") == "gesture":
        current_gesture = cmd.get("label", "none")
        print("Gesture detected:", current_gesture)

while lab.running():
    lab.display.fill(lab.display.BLACK)
    lab.display.text("AI GESTURE", 24, 10, lab.display.CYAN)
    
    if current_gesture == "Victory":
        # 笑臉 (Happy)
        lab.display.text(":D HAPPY", 32, 28, lab.display.GREEN)
        lab.display.fill_rect(32, 50, 12, 12, lab.display.YELLOW)
        lab.display.fill_rect(84, 50, 12, 12, lab.display.YELLOW)
        lab.display.line(40, 88, 88, 88, lab.display.YELLOW)
        lab.display.line(40, 88, 48, 96, lab.display.YELLOW)
        lab.display.line(88, 88, 80, 96, lab.display.YELLOW)
        lab.display.line(48, 96, 80, 96, lab.display.YELLOW)
    elif current_gesture == "Thumb_Up":
        # 眨眼 (Wink)
        lab.display.text(";) WINK", 36, 28, lab.display.YELLOW)
        lab.display.fill_rect(32, 50, 12, 12, lab.display.WHITE)
        lab.display.line(80, 56, 96, 56, lab.display.WHITE)
        lab.display.line(44, 90, 84, 90, lab.display.WHITE)
    elif current_gesture == "Closed_Fist":
        # 生氣 (Angry)
        lab.display.text(">: ANGRY", 32, 28, lab.display.RED)
        lab.display.line(28, 46, 48, 54, lab.display.RED)
        lab.display.line(100, 46, 80, 54, lab.display.RED)
        lab.display.fill_rect(34, 56, 10, 10, lab.display.RED)
        lab.display.fill_rect(84, 56, 10, 10, lab.display.RED)
        lab.display.line(40, 92, 88, 92, lab.display.RED)
    else:
        # 平淡 (Normal)
        lab.display.text("NORMAL", 40, 28, lab.display.WHITE)
        lab.display.fill_rect(36, 52, 10, 10, lab.display.WHITE)
        lab.display.fill_rect(82, 52, 10, 10, lab.display.WHITE)
        lab.display.line(44, 88, 84, 88, lab.display.WHITE)
        
    lab.display.show()
    lab.sleep(0.08)
