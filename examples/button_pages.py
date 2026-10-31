# 接收遠端 A/B/C/D 按鈕切換四個不同功能分頁
current_page = "A"

@lab.on_cmd
def on_cmd(cmd):
    global current_page
    if cmd.get("op") == "btn" and cmd.get("v") == 1:
        btn_id = cmd.get("id")
        if btn_id in ["A", "B", "C", "D"]:
            current_page = btn_id
            print("Switched to page:", current_page)

while lab.running():
    lab.display.fill(lab.display.BLACK)
    
    # 頂部導覽列顯示目前分頁
    lab.display.rect(0, 0, 128, 20, lab.display.BLUE)
    lab.display.text("[A] [B] [C] [D]", 8, 6, lab.display.WHITE)
    lab.display.text("^", 16 + ["A", "B", "C", "D"].index(current_page) * 32, 14, lab.display.YELLOW)
    
    # 根據分頁繪製不同內容
    if current_page == "A":
        lab.display.text("PAGE A: HOME", 16, 40, lab.display.CYAN)
        lab.display.text("ESP32 AI Lab", 16, 65, lab.display.WHITE)
        lab.display.text("Ready to learn", 12, 85, lab.display.GREEN)
    elif current_page == "B":
        lab.display.text("PAGE B: SENSOR", 12, 40, lab.display.YELLOW)
        batt = lab.battery()
        batt_s = "{:.2f}V".format(batt) if batt else "USB"
        lab.display.text("Batt: " + batt_s, 16, 65, lab.display.WHITE)
    elif current_page == "C":
        lab.display.text("PAGE C: NETWORK", 8, 40, lab.display.GREEN)
        rssi = lab.rssi()
        rssi_s = str(rssi) + "dBm" if rssi else "Offline"
        lab.display.text("RSSI: " + rssi_s, 16, 65, lab.display.WHITE)
    elif current_page == "D":
        lab.display.text("PAGE D: ABOUT", 12, 40, lab.display.RED)
        lab.display.text("T-QT Pro S3", 16, 65, lab.display.WHITE)
        lab.display.text("128x128 Color", 16, 85, lab.display.CYAN)
        
    lab.display.show()
    lab.sleep(0.08)
