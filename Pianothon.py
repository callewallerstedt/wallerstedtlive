from TikTokLive import TikTokLiveClient
from TikTokLive.types.events import GiftEvent
import pygame
import multiprocessing
from math import *
from PIL import Image, ImageDraw

# Initialize pygame
pygame.init()

# Your main loop
thankvalue = 1

def mainloop(totalcoins, thankstr):
    global thankvalue

    def calcpieend(target, cur, speed):
        newStartpie = cur+(target-cur)/50
        return(newStartpie)
    def updatethank():
        return(thankstr.value)
    def calcminadded(c):
        coins = c
        added = 0
        for q in range(30):
            #print(f"q is {q}")
            for i in range(15):
                #print(f"removing {basecoinsthres+incr*q} from coins play time is now: {15+added}")
                coins -= basecoinsthres+incr*q
                if coins < 0:
                    return(added)
                added += 1


    white = (230,230,230)
    dgrey = (30,30,30)
    red = (255,0,0)
    bgcolor = dgrey
    indicator = (224, 168, 0)
    indicatorbg = bgcolor


    running = 1
    width = 1920/1.25
    height = 1080/1.25

    timercy = height/2
    timers = 800
    timercx = timers/2+(height-timers)/2

    infocenterx = width-(width-((height-timers)/2+timers))/2

    incr = 5
    basecoinsthres = 15
    coinsthres = basecoinsthres
    starttime = 60*15
    addedmins = 0
    pieSpeed = 1

    thanklist = []
    activethank = ""

    oldReached = 0
    curStartpie = -90

    font = pygame.font.Font('RobotoMono-Regular.ttf', int(timers/5))
    font2 = pygame.font.Font('freesansbold.ttf', 40)
    fontsmall = pygame.font.Font('freesansbold.ttf', 16)
    fontinfo = pygame.font.Font('freesansbold.ttf', 70)

    display = pygame.display.set_mode((width,height))
    pygame.display.set_caption('Pianothon by cwallerstedt')

    while running:
        millis = pygame.time.get_ticks()
        secondsleft = int (round((starttime+addedmins*60-pygame.time.get_ticks()/1000),0))
        m, s = divmod(secondsleft, 60)
        h, m = divmod(m, 60)
        timeleftstr = str(f'{h:d}:{m:02d}:{s:02d}')
        
        if thankstr.value not in thanklist:
            thanklist.append(thankstr.value)
        if millis%4000<40:
            activethank = updatethank()


        if totalcoins.value < 15*basecoinsthres:
            print("1 QUARTER")
            coinsthres = basecoinsthres  # Access the value attribute
        elif totalcoins.value < 15*basecoinsthres+incr*1:
            print("2 QUARTER")
            coinsthres = basecoinsthres+incr*1
        elif totalcoins.value < 15*basecoinsthres+incr*2:
            print("3 QUARTER")
            coinsthres = basecoinsthres+incr*2
        elif totalcoins.value < 15*basecoinsthres+incr*3:
            coinsthres = basecoinsthres+incr*3
        elif totalcoins.value < 15*basecoinsthres+incr*4:
            coinsthres = basecoinsthres+incr*4
        elif totalcoins.value < 15*basecoinsthres+incr*5:
            coinsthres = basecoinsthres+incr*5
        elif totalcoins.value < 15*basecoinsthres+incr*6:
            coinsthres = basecoinsthres+incr*6
        elif totalcoins.value < 15*basecoinsthres+incr*7:
            coinsthres = basecoinsthres+incr*7
        elif totalcoins.value < 15*basecoinsthres+incr*8:
            coinsthres = basecoinsthres+incr*8
        
        reached = totalcoins.value / coinsthres
        desStartpie = reached*360-90
        startpie = calcpieend(desStartpie,curStartpie,pieSpeed)
        curStartpie = startpie
        (addedmins,scrap) = divmod(reached,1)
        addedmins = int(addedmins)
        
       #print(reached, totalcoins.value, int(startpie))
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = 0
            #print(event)

        display.fill((0,0,0))
        pygame.draw.circle(display,white,(timercx,timercy),timers/2+4)
        pygame.draw.circle(display,indicator,(timercx,timercy),timers/2)
        #### pieslice
        pil_size = timers
        pil_image = Image.new("RGBA", (pil_size, pil_size))
        pil_draw = ImageDraw.Draw(pil_image)
        pil_draw.pieslice((0, 0, pil_size-1, pil_size-1), startpie, 270, fill=indicatorbg) 
        mode = pil_image.mode
        size = pil_image.size
        data = pil_image.tobytes()
        image = pygame.image.fromstring(data, size, mode)
        image_rect = image.get_rect(center=(timercx,timercy))
        display.blit(image, image_rect) # <- display image
        ####
        pygame.draw.circle(display,white,(timercx,timercy),timers/2-timers/25)

        timetext = font.render(timeleftstr, True, dgrey, white)
        timetextRect = timetext.get_rect()
        timetextRect.center = ((timercx,timercy))
        display.blit(timetext, timetextRect)

        addedtext = font2.render(str(totalcoins.value%coinsthres)+"/"+str(coinsthres)+" Coins", True, dgrey)
        addedtextRect = addedtext.get_rect()
        addedtextRect.center = ((timercx,timercy+timers/7))
        display.blit(addedtext, addedtextRect)

        totalcointext = fontsmall.render(str(totalcoins.value), True, (100,100,100))
        totalcoinRect = totalcointext.get_rect()
        totalcoinRect.topleft = ((2,2))
        display.blit(totalcointext, totalcoinRect)

        totaltimetext = fontsmall.render(str(int((millis/1000)/60)), True, (100,100,100))
        totaltimeRect = totaltimetext.get_rect()
        totaltimeRect.bottomleft = ((2,height-2))
        display.blit(totaltimetext, totaltimeRect)
        if addedmins >= 60:
            hrs,mins = divmod(addedmins,60)
            timeaddedstr = (f"{hrs} Hours {mins} Minutes")
        else:
            timeaddedstr = (f"{addedmins} Minutes")
        InfoTexttext = fontinfo.render(f"For every {coinsthres} coins", True, white)
        InfoTextRect = InfoTexttext.get_rect()
        InfoTextRect.center = ((infocenterx,240))
        display.blit(InfoTexttext, InfoTextRect)
        InfoTexttext = fontinfo.render("1 minute is added", True, white)
        InfoTextRect = InfoTexttext.get_rect()
        InfoTextRect.center = ((infocenterx,305))
        display.blit(InfoTexttext, InfoTextRect)

        addedtext = font2.render(timeaddedstr, True, (indicator))
        addedtextRect = addedtext.get_rect()
        addedtextRect.center = (width*4/5,height/2)
        display.blit(addedtext, addedtextRect)

        thanktext = font2.render(activethank, True, white)
        thanktextRect = thanktext.get_rect()
        thanktextRect.center = (infocenterx-100,30)
        display.blit(thanktext, thanktextRect)

        
        
        pygame.display.update()

if __name__ == '__main__':
    # Initialize multiprocessing manager
    manager = multiprocessing.Manager()
    totalcoins = manager.Value('i', 0)  # Create a shared integer variable
    thankstr = manager.Value("c","")
    def giftreceived(coins):
        totalcoins.value += coins
        print("total coins:", totalcoins.value)

    client = TikTokLiveClient("@layla.faveri")

    mainloop_process = multiprocessing.Process(target=mainloop, args=(totalcoins,thankstr))
    mainloop_process.start()

    # Define the event handler after defining the client
    @client.on("gift")
    async def on_gift(event: GiftEvent):
        if event.gift.streakable and not event.gift.streaking:
            print(int(event.gift.info.diamond_count)*int(event.gift.count))
            giftreceived(int(event.gift.info.diamond_count)*int(event.gift.count))
            if(int(event.gift.info.diamond_count)*int(event.gift.count)>=thankvalue):
                thankstr.value = (f"Thanks to {event.user.nickname}")
                print(thankstr.value)

        elif not event.gift.streakable:
            print(int(event.gift.info.diamond_count))
            giftreceived(int(event.gift.info.diamond_count))
            if(int(event.gift.info.diamond_count)>=thankvalue):
                thankstr.value = (f"Thanks to {event.user.nickname}")
                print(thankstr.value)

    # Start the TikTokLive client in the main process
    client.run()
