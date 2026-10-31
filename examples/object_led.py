# 辨識鏡頭中的指定目標物件，符合時點亮 LED 並警示
TARGET_OBJECT = "cup"
detected = False
confidence = 0.0

@lab.on_cmd
def on_cmd(cmd):
    global detected, confidence
    if cmd.get("op") == "vision":
        label = cmd.get("label", "")
        score = float(cmd.get("score", 0.0))
        if label == TARGET_OBJECT and score >= 0.5:
            detected = True
            confidence = score
            lab.led(1)
        else:
            detected = False
            confidence = score
            lab.led(0)

while lab.running():
    lab.display.fill(lab.display.BLACK)
    lab.display.text("OBJECT DETECT", 12, 12, lab.display.CYAN)
    lab.display.text("Target: " + TARGET_OBJECT, 14, 30, lab.display.WHITE)
    
    if detected:
        lab.display.fill_rect(10, 52, 108, 40, lab.display.GREEN)
        lab.display.text("FOUND!", 38, 60, lab.display.BLACK)
        lab.display.text("Conf: {:.1f}%".format(confidence * 100), 20, 76, lab.display.BLACK)
        print("Target object found! Score:", confidence)
    else:
        lab.display.rect(10, 52, 108, 40, lab.display.RED)
        lab.display.text("SCANNING...", 22, 68, lab.display.YELLOW)
        
    lab.display.text("LED: " + ("ON" if detected else "OFF"), 34, 106, lab.display.WHITE)
    lab.display.show()
    lab.sleep(0.1)
