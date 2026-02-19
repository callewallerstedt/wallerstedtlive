input = input("Enter a number: ")
output = ""
count = 0
for num in input:
    if int(input) <= 19:
        output = ["Ett","två","tre","fyra","fem","sex","sju","åtta","nio","tio","elva","tolv","tretton","fjorton","femton","sexton","sjutton","arton","nitton"][int(num)]
    output += ["Ett","två","tre","fyra","fem","sex","sju","åtta","nio"][int(num)]


    output += ["","ttio","hundra","tusen"][len(input)-]

    count += 1

print(output)