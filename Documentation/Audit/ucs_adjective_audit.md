# UCS synonym audit — adjectives & adverbs

Heuristic flags (curated adjective set + `-ly` adverb rule). **Spread** = distinct subcategories claiming the token as a synonym; high spread = most likely to hijack unrelated file names. **own** = the token is also some subcategory's own name-word somewhere (handle with care).

Flagged **140** distinct tokens out of 10005 unique synonym tokens.

| spread | pos | token | own? | status | verdict | subcategories |
|---:|---|---|:---:|---|---|---|
| 22 | adverb | **silly** |  | live | add-stopword — generic modifier | CARTOON / ANIMAL, CARTOON / BOING, CARTOON / CLANG, CARTOON / CREAK, CARTOON / HORN, CARTOON / IMPACT, CARTOON / MACHINE, CARTOON / MISC … |
| 13 | adjective | **high** | yes | stopworded | keep — already handled | AMBIENCE / HITECH, AMBIENCE / SCHOOL, AMBIENCE / SCIFI, AMBIENCE / URBAN, BRASS / TRUMPET, DOORS / HITECH, DRUMS / TOM, GAMES / MISC … |
| 12 | adjective | **old** |  | stopworded | keep — already handled | AMBIENCE / FOREST, AMBIENCE / HISTORICAL, BEEPS / LOFI, DOORS / ANTIQUE, DOORS / CREAK, GEOTHERMAL / GEYSER, GUNS / ANTIQUE, MACHINES / ANTIQUE … |
| 10 | adjective | **light** |  | stopworded | keep — already handled | FIRE / IGNITE, GUNS / ARTILLERY, LASERS / BEAM, MAGIC / SHIMMER, MECHANICAL / SWITCH, MOVEMENT / PRESENCE, TRAINS / ELECTRIC, TRAINS / HORN … |
| 10 | adjective | **vintage** |  | live | leave — semantic evidence | AIRCRAFT / PROP, AMBIENCE / HISTORICAL, BEEPS / LOFI, DOORS / ANTIQUE, GUNS / ANTIQUE, MACHINES / ANTIQUE, MOTORS / ANTIQUE, SCIFI / RETRO … |
| 8 | adjective | **double** | yes | live | add-stopword — generic modifier | GUITAR / MANDOLIN, GUNS / PISTOL, GUNS / SHOTGUN, OBJECTS / TAPE, STRINGS / DOUBLE BASS, VEHICLES / BUS, WOODWIND / BASSOON, WOODWIND / OBOE |
| 8 | adverb | **gravelly** |  | live | leave — semantic evidence | ROCKS / BREAK, ROCKS / CRASH & DEBRIS, ROCKS / FRICTION, ROCKS / HANDLE, ROCKS / IMPACT, ROCKS / MISC, ROCKS / MOVEMENT, ROCKS / TONAL |
| 7 | adjective | **square** |  | live | add-stopword — generic modifier | AMBIENCE / MARKET, AMBIENCE / PARK, AMBIENCE / PUBLIC PLACE, AMBIENCE / TOWN, ARCHIVED / TEST TONE, PIANO / MISC, SYNTH / LEAD |
| 6 | adjective | **giant** |  | stopworded | keep — already handled | CREATURES / AQUATIC, CREATURES / ELEMENTAL, CREATURES / INSECTOID, CREATURES / REPTILIAN, NATURAL DISASTER / TSUNAMI, WINGS / CREATURE |
| 6 | adjective | **low** |  | stopworded | keep — already handled | BRASS / TUBA, CROWDS / QUIET, DESIGNED / BASS DIVE, DESIGNED / BOOM, DRUMS / TOM, LOOPS / BASS LOOP |
| 6 | adjective | **synthetic** |  | live | leave — semantic evidence | PLASTIC / MISC, ROBOTS / MISC, ROBOTS / MOVEMENT, ROBOTS / VOCAL, RUBBER / MISC, WIND / DESIGNED |
| 5 | adjective | **gritty** |  | live | leave — semantic evidence | DESIGNED / GRANULAR, DIRT & SAND / CRASH & DEBRIS, DIRT & SAND / DUST, DIRT & SAND / MISC, ROCKS / CRASH & DEBRIS |
| 5 | adjective | **hot** |  | stopworded | keep — already handled | AIRCRAFT / BALLOON, AIRCRAFT / MISC, AMBIENCE / DESERT, GEOTHERMAL / MISC, MACHINES / APPLIANCE |
| 5 | adjective | **mini** |  | live | add-stopword — generic modifier | AMBIENCE / AMUSEMENT, CYMBALS / SPLASH, MACHINES / HVAC, VEHICLES / TRUCK VAN & SUV, WINDOWS / COVERING |
| 4 | adjective | **big** |  | stopworded | keep — already handled | ANIMALS / CAT WILD, BELLS / LARGE, BRASS / SECTION, VEHICLES / FREIGHT |
| 4 | adjective | **heavy** |  | stopworded | keep — already handled | AMBIENCE / INDUSTRIAL, GUNS / ARTILLERY, HUMAN / SNORE, MACHINES / INDUSTRIAL |
| 4 | adjective | **little** |  | stopworded | keep — already handled | AMBIENCE / SPORT, BIRDS / WADING, CROWDS / CHILDREN, VOICES / BABY |
| 4 | adjective | **small** |  | stopworded | keep — already handled | AMBIENCE / TOWN, BOATS / MOTORBOAT, CROWDS / CONVERSATION, DIRT & SAND / DUST |
| 3 | adjective | **ancient** |  | live | leave — semantic evidence | AMBIENCE / HISTORICAL, DOORS / ANTIQUE, MOTORS / ANTIQUE |
| 3 | adjective | **broken** |  | live | leave — semantic evidence | GLASS / CRASH & DEBRIS, GORE / BONE, WOOD / CRASH & DEBRIS |
| 3 | adjective | **deep** |  | stopworded | keep — already handled | BOATS / SUBMARINE, DESIGNED / BOOM, DESIGNED / RUMBLE |
| 3 | adjective | **dry** |  | stopworded | keep — already handled | AMBIENCE / DESERT, GUNS / HANDLE, OBJECTS / WRITING |
| 3 | adjective(compar/super) | **dryer** |  | live | add-stopword — generic modifier | BEEPS / APPLIANCE, DOORS / APPLIANCE, MACHINES / APPLIANCE |
| 3 | adjective | **ethereal** | yes | live | leave — semantic evidence | CREATURES / ETHEREAL, DESIGNED / ETHEREAL, MAGIC / ANGELIC |
| 3 | adjective | **fast** |  | stopworded | keep — already handled | AMBIENCE / RESTAURANT & BAR, BOATS / MILITARY, DESIGNED / WHOOSH |
| 3 | adjective | **frozen** |  | live | leave — semantic evidence | AMBIENCE / TUNDRA, ICE / MISC, WEATHER / HAIL |
| 3 | adjective | **full** |  | live | add-stopword — generic modifier | GUNS / AUTOMATIC, LOOPS / DRUM LOOP, PIANO / UPRIGHT |
| 3 | adverb | **ghostly** |  | live | leave — semantic evidence | DESIGNED / EERIE, DESIGNED / ETHEREAL, DESIGNED / VOCAL |
| 3 | adjective | **long** |  | stopworded | keep — already handled | GUNS / ANTIQUE, GUNS / RIFLE, SPORTS / TRACK & FIELD |
| 3 | adjective(compar/super) | **matter** |  | live | add-stopword — generic modifier | AMBIENCE / PROTEST, CHEMICALS / MISC, GORE / SOURCE |
| 3 | adjective | **natural** |  | live | leave — semantic evidence | AMBIENCE / EMERGENCY, FIRE / GAS, MAGIC / ELEMENTAL |
| 3 | adverb | **otherworldly** |  | live | leave — semantic evidence | CREATURES / ETHEREAL, DESIGNED / EERIE, DESIGNED / ETHEREAL |
| 3 | adjective | **rapid** |  | live | add-stopword — generic modifier | DESIGNED / WHOOSH, TRAINS / HIGH SPEED, TRAINS / SUBWAY |
| 3 | adjective | **raw** | yes | live | leave — semantic evidence | ARCHIVED / RAW, DESIGNED / SOURCE, GORE / SOURCE |
| 3 | adjective | **slow** |  | stopworded | keep — already handled | BEEPS / APPLIANCE, CROWDS / APPLAUSE, MACHINES / APPLIANCE |
| 3 | adjective | **strong** |  | live | add-stopword — generic modifier | NATURAL DISASTER / TYPHOON, WIND / GUST, WIND / TURBULENT |
| 3 | adjective | **wet** |  | stopworded | keep — already handled | HUMAN / COUGH, RAIN / GENERAL, WATER / STEAM |
| 2 | adjective | **aged** |  | live | leave — semantic evidence | DOORS / ANTIQUE, MOTORS / ANTIQUE |
| 2 | adjective | **burning** | yes | live | leave — semantic evidence | FIRE / BURNING, FOOD & DRINK / COOKING |
| 2 | adjective | **calm** |  | live | leave — semantic evidence | AMBIENCE / AIR, CROWDS / QUIET |
| 2 | adjective(compar/super) | **cleaner** |  | live | add-stopword — generic modifier | BEEPS / APPLIANCE, MACHINES / APPLIANCE |
| 2 | adjective | **clear** |  | live | add-stopword — generic modifier | AMBIENCE / AIR, HUMAN / COUGH |
| 2 | adverb | **damselfly** |  | live | leave — real word (-ly misfire) | ANIMALS / INSECT, WINGS / INSECT |
| 2 | adjective | **dead** |  | live | add-stopword — generic modifier | AMBIENCE / ROOM TONE, CREATURES / HUMANOID |
| 2 | adverb | **electrically** |  | live | leave — semantic evidence | ELECTRICITY / MISC, ELECTRICITY / SPARKS |
| 2 | adjective | **empty** |  | live | add-stopword — generic modifier | AMBIENCE / DESERT, WATER / POUR |
| 2 | adjective | **flat** |  | live | add-stopword — generic modifier | AMBIENCE / RESIDENTIAL, VEHICLES / TIRE |
| 2 | adverb | **heavenly** |  | live | leave — semantic evidence | DESIGNED / ETHEREAL, MAGIC / ANGELIC |
| 2 | adjective | **icy** |  | live | leave — semantic evidence | AMBIENCE / TUNDRA, ICE / MISC |
| 2 | adjective | **large** |  | stopworded | keep — already handled | BOATS / SHIP, DOORS / DUNGEON |
| 2 | adjective(compar/super) | **lighter** |  | live | add-stopword — generic modifier | AIRCRAFT / BALLOON, FIRE / IGNITE |
| 2 | adjective | **modern** |  | live | leave — semantic evidence | AMBIENCE / HITECH, DOORS / HITECH |
| 2 | adjective | **processed** |  | live | leave — semantic evidence | DESIGNED / VOCAL, VOICES / FUTZED |
| 2 | adjective | **quiet** |  | stopworded | keep — already handled | AMBIENCE / AIR, AMBIENCE / ROOM TONE |
| 2 | adjective | **round** |  | live | add-stopword — generic modifier | AMBIENCE / AMUSEMENT, MACHINES / AMUSEMENT |
| 2 | adjective | **scary** |  | live | leave — semantic evidence | DESIGNED / EERIE, DOORS / CREAK |
| 2 | adjective | **short** |  | stopworded | keep — already handled | ELECTRICITY / SPARKS, SYNTH / PLUCK |
| 2 | adjective | **single** |  | live | add-stopword — generic modifier | AMBIENCE / RESIDENTIAL, GUNS / PISTOL |
| 2 | adjective | **soft** |  | stopworded | keep — already handled | CROWDS / QUIET, SYNTH / PAD |
| 2 | adverb | **volcanically** |  | live | leave — semantic evidence | GEOTHERMAL / LAVA, NATURAL DISASTER / VOLCANO |
| 2 | adverb | **wizardly** |  | live | leave — semantic evidence | MAGIC / MISC, MAGIC / SPELL |
| 1 | adjective | **aggressive** |  | live | leave — semantic evidence | CROWDS / PANIC |
| 1 | adjective | **angry** |  | live | leave — semantic evidence | AMBIENCE / PROTEST |
| 1 | adjective | **bad** |  | live | leave — semantic evidence | MAGIC / EVIL |
| 1 | adjective | **bright** |  | live | add-stopword — generic modifier | CYMBALS / CRASH |
| 1 | adverb | **brolly** |  | live | leave — real word (-ly misfire) | OBJECTS / UMBRELLA |
| 1 | adverb | **broly** |  | live | leave — real word (-ly misfire) | OBJECTS / UMBRELLA |
| 1 | adverb | **bubbly** |  | live | leave — semantic evidence | WATER / BUBBLES |
| 1 | adverb | **chemically** |  | live | leave — semantic evidence | CHEMICALS / REACTION |
| 1 | adverb | **churchly** |  | live | leave — real word (-ly misfire) | AMBIENCE / RELIGIOUS |
| 1 | adjective | **close** |  | live | add-stopword — generic modifier | VEHICLES / DOOR |
| 1 | adjective(compar/super) | **closer** |  | live | add-stopword — generic modifier | DOORS / HYDRAULIC & PNEUMATIC |
| 1 | adjective | **complex** |  | live | add-stopword — generic modifier | AMBIENCE / SPORT |
| 1 | adjective(compar/super) | **cooler** |  | live | add-stopword — generic modifier | MACHINES / HVAC |
| 1 | adverb | **crackly** |  | live | leave — semantic evidence | FIRE / CRACKLE |
| 1 | adjective | **creepy** |  | live | leave — semantic evidence | DESIGNED / EERIE |
| 1 | adjective | **crunchy** |  | live | add-stopword — generic modifier | COMMUNICATIONS / STATIC |
| 1 | adjective | **curved** |  | live | leave — semantic evidence | COMMUNICATIONS / TELEVISION |
| 1 | adjective | **damp** |  | live | add-stopword — generic modifier | RAIN / GENERAL |
| 1 | adjective(compar/super) | **damper** |  | live | add-stopword — generic modifier | MECHANICAL / HYDRAULIC & PNEUMATIC |
| 1 | adjective | **dark** |  | stopworded | keep — already handled | MAGIC / EVIL |
| 1 | adjective | **dense** |  | live | add-stopword — generic modifier | AMBIENCE / URBAN |
| 1 | adjective(compar/super) | **dimmer** |  | live | add-stopword — generic modifier | MECHANICAL / SWITCH |
| 1 | adjective | **dreamy** |  | live | leave — semantic evidence | DESIGNED / ETHEREAL |
| 1 | adjective | **eerie** | yes | live | leave — semantic evidence | DESIGNED / EERIE |
| 1 | adjective | **faint** |  | live | leave — semantic evidence | VOICES / WHISPER |
| 1 | adjective | **fake** |  | live | leave — semantic evidence | CARTOON / ANIMAL |
| 1 | adjective | **fat** |  | stopworded | keep — already handled | ANIMALS / CAT DOMESTIC |
| 1 | adverb | **filly** |  | live | leave — real word (-ly misfire) | ANIMALS / HORSE |
| 1 | adverb | **fleshly** |  | live | leave — semantic evidence | GORE / FLESH |
| 1 | adjective | **fuzzy** |  | live | add-stopword — generic modifier | BEEPS / LOFI |
| 1 | adjective | **grainy** |  | live | add-stopword — generic modifier | DESIGNED / GRANULAR |
| 1 | adjective | **great** |  | live | add-stopword — generic modifier | ANIMALS / PRIMATE |
| 1 | adverb | **grisly** |  | live | leave — real word (-ly misfire) | ANIMALS / WILD |
| 1 | adjective | **happy** |  | live | leave — semantic evidence | CROWDS / CHEERING |
| 1 | adjective | **hard** | yes | stopworded | keep — already handled | COMPUTERS / HARD DRIVE |
| 1 | adverb | **hilly** |  | live | leave — real word (-ly misfire) | AMBIENCE / ALPINE |
| 1 | adverb | **historically** |  | live | leave — semantic evidence | AMBIENCE / HISTORICAL |
| 1 | adverb | **lonely** |  | live | leave — semantic evidence | AMBIENCE / DESERT |
| 1 | adjective | **loose** |  | stopworded | keep — already handled | OBJECTS / COIN |
| 1 | adjective | **lush** |  | live | leave — semantic evidence | AMBIENCE / TROPICAL |
| 1 | adjective | **main** |  | live | add-stopword — generic modifier | AMBIENCE / TOWN |
| 1 | adjective | **mega** |  | live | add-stopword — generic modifier | NATURAL DISASTER / TSUNAMI |
| 1 | adjective | **mellow** |  | live | add-stopword — generic modifier | BRASS / FRENCH HORN |
| 1 | adjective | **muddy** |  | live | leave — semantic evidence | AMBIENCE / SWAMP |
| 1 | adverb | **multifamily** |  | live | leave — real word (-ly misfire) | AMBIENCE / RESIDENTIAL |
| 1 | adjective | **narrow** |  | live | add-stopword — generic modifier | TRAINS / STEAM |
| 1 | adjective | **new** |  | stopworded | keep — already handled | CROWDS / CELEBRATION |
| 1 | adverb | **noiselessly** |  | live | leave — semantic evidence | AMBIENCE / AIR |
| 1 | adjective | **organic** |  | live | leave — semantic evidence | AMBIENCE / MARKET |
| 1 | adjective | **plain** |  | live | add-stopword — generic modifier | AMBIENCE / GRASSLAND |
| 1 | adjective | **quick** |  | live | add-stopword — generic modifier | MECHANICAL / LEVER |
| 1 | adverb | **quietly** |  | live | leave — semantic evidence | VOICES / WHISPER |
| 1 | adjective | **real** |  | live | add-stopword — generic modifier | AMBIENCE / HISTORICAL |
| 1 | adjective | **rough** |  | live | leave — semantic evidence | WATER / TURBULENT |
| 1 | adverb | **sailorly** |  | live | leave — real word (-ly misfire) | AMBIENCE / NAUTICAL |
| 1 | adverb | **saintly** |  | live | leave — real word (-ly misfire) | MAGIC / ANGELIC |
| 1 | adverb | **scholarly** |  | live | leave — real word (-ly misfire) | AMBIENCE / SCHOOL |
| 1 | adverb | **seakindly** |  | live | leave — real word (-ly misfire) | AMBIENCE / NAUTICAL |
| 1 | adjective | **shiny** |  | live | add-stopword — generic modifier | MAGIC / SHIMMER |
| 1 | adverb | **shiply** |  | live | leave — real word (-ly misfire) | AMBIENCE / NAUTICAL |
| 1 | adverb | **softly** |  | live | leave — semantic evidence | VOICES / WHISPER |
| 1 | adjective | **sparse** |  | live | add-stopword — generic modifier | CROWDS / CONVERSATION |
| 1 | adjective | **spooky** |  | live | leave — semantic evidence | DESIGNED / EERIE |
| 1 | adverb | **squally** |  | live | leave — semantic evidence | WATER / TURBULENT |
| 1 | adjective | **straight** |  | live | add-stopword — generic modifier | MECHANICAL / GEARS |
| 1 | adjective | **strange** |  | live | leave — semantic evidence | DESIGNED / EERIE |
| 1 | adverb | **supernaturally** |  | live | leave — semantic evidence | MAGIC / SPELL |
| 1 | adverb | **telephonically** |  | live | leave — semantic evidence | COMMUNICATIONS / TELEPHONE |
| 1 | adverb | **telly** |  | live | leave — real word (-ly misfire) | COMMUNICATIONS / TELEVISION |
| 1 | adjective | **tight** |  | stopworded | keep — already handled | ROPE / CREAK |
| 1 | adjective | **tiny** |  | stopworded | keep — already handled | DIRT & SAND / DUST |
| 1 | adjective | **triple** |  | live | add-stopword — generic modifier | SPORTS / TRACK & FIELD |
| 1 | adverb | **unearthly** |  | live | leave — semantic evidence | DESIGNED / ETHEREAL |
| 1 | adverb | **unholy** |  | live | leave — semantic evidence | MAGIC / EVIL |
| 1 | adverb | **urgently** |  | live | leave — semantic evidence | AMBIENCE / EMERGENCY |
| 1 | adverb | **wally** |  | live | leave — real word (-ly misfire) | AMBIENCE / AMUSEMENT |
| 1 | adjective | **warm** |  | live | add-stopword — generic modifier | SYNTH / PAD |
| 1 | adjective | **weird** |  | live | leave — semantic evidence | DESIGNED / EERIE |
| 1 | adverb | **wooly** |  | live | leave — real word (-ly misfire) | CREATURES / BEAST |
