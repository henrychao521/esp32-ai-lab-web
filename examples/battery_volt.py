# 讀取鋰電池電壓並在螢幕上繪製電量指示條
while lab.running():
    v = lab.battery()
    lab.display.fill(lab.display.BLACK)
    lab.display.text("BATTERY STATUS", 8, 12, lab.display.CYAN)
    
    if v is not None:
        # 依 3.3V (0%) 到 4.2V (100%) 計算百分比
        pct = int((v - 3.3) / (4.2 - 3.3) * 100)
        pct = max(0, min(100, pct))
        
        # 傳送電壓資料到主控台
        lab.send(volt=v, percent=pct)
        print("Battery:", v, "V (", pct, "%)")
        
        # 繪製電池外框與正極頭
        lab.display.rect(14, 40, 100, 36, lab.display.WHITE)
        lab.display.fill_rect(114, 52, 6, 12, lab.display.WHITE)
        
        # 填充電量長條（依電量改變顏色）
        bar_w = int(96 * pct / 100)
        bar_c = lab.display.GREEN if pct > 30 else lab.display.RED
        if bar_w > 0:
            lab.display.fill_rect(16, 42, bar_w, 32, bar_c)
            
        lab.display.text("{:.2f}V ({}%)".format(v, pct), 24, 90, lab.display.YELLOW)
    else:
        lab.display.text("No Battery/USB", 12, 60, lab.display.RED)
        print("Battery reading unavailable")
        
    lab.display.show()
    lab.sleep(1)
