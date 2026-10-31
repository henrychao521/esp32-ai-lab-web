# 取得 Wi-Fi 訊號 dBm 並畫出 4 格階梯指示條
while lab.running():
    rssi = lab.rssi()
    lab.display.fill(lab.display.BLACK)
    lab.display.text("WIFI SIGNAL", 20, 12, lab.display.CYAN)
    
    if rssi is not None:
        # 訊號評級：-55 以上 4 格、-65 以上 3 格、-75 以上 2 格、更弱 1 格
        if rssi >= -55: bars = 4
        elif rssi >= -65: bars = 3
        elif rssi >= -75: bars = 2
        elif rssi >= -85: bars = 1
        else: bars = 0
        
        lab.send(wifi_rssi=rssi)
        print("WiFi RSSI:", rssi, "dBm, Bars:", bars)
        
        # 繪製 4 根漸高訊號柱
        for i in range(4):
            bx = 24 + i * 22
            bh = (i + 1) * 14
            by = 88 - bh
            c = lab.display.GREEN if i < bars else lab.display.BLUE
            lab.display.fill_rect(bx, by, 16, bh, c)
            lab.display.rect(bx, by, 16, bh, lab.display.WHITE)
            
        lab.display.text("{} dBm".format(rssi), 36, 100, lab.display.YELLOW)
    else:
        lab.display.text("DISCONNECTED", 16, 60, lab.display.RED)
        print("WiFi not connected")
        
    lab.display.show()
    lab.sleep(1)
