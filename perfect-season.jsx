import { useState, useEffect, useMemo, useRef } from "react";
import {
  sget, sset, sdel, clearDraft,
  fetchLeaderboardTop, fetchOwnRank, fetchSiteTotals, fetchDailyTop, upsertDailyRun,
  authSignUp, authSignIn, authSignOut, authGetSession, authOnChange, mapAuthError,
  fetchProfile, updateProfile,
} from "./storage.js";

const DATA = {"n":["Drew Bledsoe","Quincy Carter","Vinny Testaverde","Troy Aikman","Emmitt Smith","Richie Anderson","Julius Jones","Troy Hambrick","Marion Barber","Chris Warren","Raghib Ismail","Terry Glenn","Keyshawn Johnson","Joey Galloway","James McKnight","Antonio Bryant","Jason Tucker","Wane McGarity","Jason Witten","David LaFleur","Jackie Harris","Tony McGee","Trent Green","Elvis Grbac","Priest Holmes","Larry Johnson","Tony Richardson","Derrick Blaylock","Donnell Bennett","Kimble Anders","Derrick Alexander","Eddie Kennison","Johnnie Morton","Joe Horn","Sylvester Morris","Dante Hall","Marc Boerigter","Samie Parker","Tony Gonzalez","Mikhael Ricks","Jason Dunn","Brad Johnson","Mark Brunell","Tony Banks","Patrick Ramsey","Stephen Davis","Clinton Portis","Larry Centers","Kenny Watson","Brian Mitchell","Rock Cartwright","Santana Moss","Laveranues Coles","Michael Westbrook","Rod Gardner","Albert Connell","Derrius Thompson","James Thrash","Irving Fryar","Chris Cooley","Stephen Alexander","Mike Sellers","Zeron Flemister","Tom Brady","Corey Dillon","Antowain Smith","Kevin Faulk","Terry Allen","Patrick Pass","J.R. Redmond","Troy Brown","Deion Branch","David Patten","David Givens","Shawn Jefferson","Tim Dwight","Tony Simmons","Daniel Graham","Christian Fauria","Benjamin Watson","Ben Coates","Shaun King","Brian Griese","Chris Simms","Warrick Dunn","Michael Pittman","Mike Alstott","Cadillac Williams","Thomas Jones","Keenan McCardell","Michael Clayton","Jacquez Green","Joe Jurevicius","Charles Lee","Ike Hilliard","Ken Dilger","Alex Smith","Dave Moore","Rickey Dudley","Mike Vick","Chris Chandler","Doug Johnson","Jamal Anderson","T.J. Duckett","Bob Christian","Maurice Smith","Ken Oxendine","Terance Mathis","Brian Finneran","Peerless Price","Tony Martin","Michael Jenkins","Roddy White","Alge Crumpler","Reggie Kelly","Brian Kozlowski","Chad Pennington","Ray Lucas","Brooks Bollinger","Curtis Martin","Jerald Sowell","LaMont Jordan","Cedric Houston","Wayne Chrebet","Justin McCareins","Dedric Ward","Curtis Conway","Anthony Becht","Doug Jolley","Chris Baker","Kerry Collins","Eli Manning","Kurt Warner","Kent Graham","Tiki Barber","Ron Dayne","Greg Comella","Brandon Jacobs","Dorsey Levens","Joe Montgomery","Amani Toomer","Plaxico Burress","Ron Dixon","Tim Carter","Jeremy Shockey","Pete Mitchell","Dan Campbell","Joey Harrington","Charlie Batch","Gus Frerotte","Mike McMahon","James Stewart","Kevin Jones","Shawn Bryson","Cory Schlesinger","Lamont Warren","Artose Pinner","Germane Crowell","Roy Williams","Bill Schroeder","Az-Zahir Hakim","Herman Moore","Scott Vines","Charles Rogers","David Sloan","Marcus Pollard","Jake Plummer","Josh McCown","Jeff Blake","Marcel Shipp","Adrian Murrell","J.J. Arrington","Larry Fitzgerald","David Boston","Anquan Boldin","Frank Sanders","Rob Moore","Bryant Johnson","MarTay Jenkins","Jason McAddley","Freddie Jones","Adam Bergen","Tywan Mitchell","Terry Hardy","Kordell Stewart","Ben Roethlisberger","Tommy Maddox","Mike Tomczak","Willie Parker","Jerome Bettis","Richard Huntley","Amos Zereoue","Duce Staley","Chris Fuamatu-Ma'afala","Hines Ward","Troy Edwards","Bobby Shaw","Antwaan Randle El","Cedrick Wilson","Courtney Hawkins","Heath Miller","Mark Bruener","Jerame Tuman","Steve Beuerlein","Jake Delhomme","Chris Weinke","Rodney Peete","Nick Goings","DeShaun Foster","Tim Biakabutuka","Lamar Smith","Steve Smith","Muhsin Muhammad","Patrick Jeffers","Donald Hayes","Keary Colbert","Ricky Proehl","Isaac Byrd","Wesley Walls","Kris Mangum","Michael Gaines","Mike Seidman","Carson Palmer","Jon Kitna","Rudi Johnson","Chris Perry","Brandon Bennett","Michael Basnight","Chad Johnson","T.J. Houshmandzadeh","Peter Warrick","Darnay Scott","Carl Pickens","Chris Henry","Ron Dugans","Kelley Washington","Matt Schobel","Tony Stewart","Brett Favre","Ahman Green","Samkon Gado","Tony Fisher","William Henderson","Najeh Davenport","Javon Walker","Donald Driver","Antonio Freeman","Antonio Chatman","Corey Bradford","Robert Ferguson","Bubba Franks","Donald Lee","David Martin","Tyrone Davis","Byron Leftwich","David Garrard","Fred Taylor","Stacey Mack","Greg Jones","Elvis Joseph","Alvin Pearman","Jimmy Smith","Ernest Wilford","Matt Jones","Reggie Williams","Kevin Johnson","Kyle Brady","Damon Jones","George Wrighster","Rich Gannon","Charlie Garner","Tyrone Wheatley","Napoleon Kaufman","Randy Jordan","Tim Brown","Jerry Rice","Jerry Porter","Randy Moss","Ronald Curry","Andre Rison","Doug Gabriel","James Jett","Roland Williams","Courtney Anderson","Cade McNown","Jim Miller","Shane Matthews","Anthony Thomas","James Allen","Curtis Enis","Adrian Peterson","Leon Johnson","Marcus Robinson","Marty Booker","Bobby Engram","Dez White","David Terrell","Desmond Clark","Ryan Wetnight","John Davis","Fred Baxter","Donovan McNabb","Brian Westbrook","Correll Buckhalter","Darnell Autry","Terrell Owens","Todd Pinkston","Charles Johnson","Torrance Small","Reggie Brown","Greg Lewis","Chad Lewis","L.J. Smith","Luther Broughton","Jeff Thomason","Matt Hasselbeck","Shaun Alexander","Ricky Watters","Mack Strong","Reggie Brown","Darrell Jackson","Koren Robinson","Derrick Mayes","Sean Dawkins","D.J. Hackett","Jerramy Stevens","Itula Mili","Daunte Culpepper","Jeff George","Randall Cunningham","Robert Smith","Moe Williams","Michael Bennett","Mewelde Moore","Onterrio Smith","Leroy Hoard","Cris Carter","Nate Burleson","D'Wayne Bates","Travis Taylor","Jake Reed","Kelly Campbell","Jermaine Wiggins","Byron Chamberlain","Jimmy Kleinsasser","Andrew Glover","Mike Anderson","Reuben Droughns","Olandis Gary","Tatum Bell","Terrell Davis","Rod Smith","Ed McCaffrey","Ashley Lelie","Darius Watts","Shannon Sharpe","Jeb Putzier","Tim Couch","Jeff Garcia","Trent Dilfer","Kelly Holcomb","Terry Kirby","Jamel White","William Green","Travis Prentice","Lee Suggs","Quincy Morgan","Dennis Northcutt","Andre Davis","Darrin Chiaverini","Braylon Edwards","Steve Heiden","Aaron Shea","Mark Campbell","Irv Smith","Peyton Manning","Edgerrin James","Dominic Rhodes","James Mungro","Ricky Williams","Marvin Harrison","Reggie Wayne","Brandon Stokley","Jerome Pathon","Terrence Wilkins","Qadry Ismail","Troy Walters","E.G. Green","Dallas Clark","Bryan Fletcher","Jay Fiedler","Dan Marino","Damon Huard","Ricky Williams","Ronnie Brown","Sammy Morris","Stanley Pritchett","Travis Minor","Chris Chambers","Oronde Gadsden","Leslie Shepherd","O.J. McDuffie","Randy McMichael","Troy Drayton","Jed Weaver","Steve McNair","Billy Volek","Neil O'Donnell","Eddie George","Chris Brown","Skip Hicks","Robert Holcombe","John Simon","Drew Bennett","Derrick Mason","Kevin Dyson","Yancey Thigpen","Chris Sanders","Tyrone Calico","Brandon Jones","Frank Wycheck","Ben Troupe","Erron Kinney","Bo Scaife","Doug Flutie","Rob Johnson","Alex Van Pelt","Travis Henry","Willis McGahee","Jonathan Linton","Eric Moulds","Lee Evans","Josh Reed","Jeremy McDaniel","Andre Reed","Kevin R. Williams","Jay Riemersma","Tim Rattay","Garrison Hearst","Kevan Barlow","Frank Gore","Fred Beasley","Maurice Hicks","Tai Streets","J.J. Stokes","Brandon Lloyd","Arnaz Battle","Eric Johnson","Greg Clark","Aaron Brooks","Billy Joe Tolliver","Deuce McAllister","Aaron Stecker","Chad Morton","Willie Jackson","Donte' Stallworth","Keith Poole","Andre Hastings","Boo Williams","Zach Hilton","Ernie Conwell","Kyle Boller","Jamal Lewis","Errict Rhett","Chester Taylor","Jason Brookins","Justin Armour","Mark Clayton","Pat Johnson","Clarence Moore","Todd Heap","Terry Jones","Daniel Wilcox","Drew Brees","Jim Harbaugh","Ryan Leaf","LaDainian Tomlinson","Terrell Fletcher","Jesse Chatman","Kenny Bynum","Fred McCrary","Michael Turner","Jeff Graham","Eric Parker","Reche Caldwell","Kassim Osgood","Antonio Gates","Marc Bulger","Marshall Faulk","Steven Jackson","Trung Canidate","Lamar Gordon","Justin Watson","Torry Holt","Isaac Bruce","Kevin Curtis","Dane Looker","Shaun McDonald","Brandon Manumaleuna","David Carr","Domanick Williams","Jonathan Wells","Vernand Morency","Andre Johnson","Jabar Gaffney","Derick Armstrong","JaJuan Dawson","Billy Miller","Marcellus Rivers","Jay Cutler","Kyle Orton","Tim Tebow","Knowshon Moreno","Mike Bell","Selvin Young","Peyton Hillis","Brandon Marshall","Eddie Royal","Demaryius Thomas","Tony Scheffler","Josh Freeman","Bruce Gradkowski","Earnest Graham","LeGarrette Blount","Derrick Ward","Mike Williams","Arrelious Benn","Sammie Stroughter","Maurice Stovall","Kellen Winslow","John Gilmore","Ahmad Bradshaw","Steve Smith","Hakeem Nicks","Mario Manningham","Domenik Hixon","Derek Hagan","Kevin Boss","Travis Beckum","Tony Romo","Felix Jones","Tashard Choice","Miles Austin","Patrick Crayton","Dez Bryant","Sam Hurd","Martellus Bennett","Chad Henne","Cleo Lemon","Patrick Cobbs","Lorenzo Booker","Davone Bess","Ted Ginn","Wes Welker","Greg Camarillo","Brian Hartline","Anthony Fasano","Justin Peelle","Matt Cassel","BenJarvus Green-Ellis","Danny Woodhead","Laurence Maroney","Brandon Tate","Rob Gronkowski","Aaron Hernandez","Sam Bradford","Brian Leonard","Antonio Pittman","Kenneth Darby","Danny Amendola","Donnie Avery","Brandon Gibson","Laurent Robinson","Daniel Fells","Joe Klopfenstein","Michael Hoomanawanui","Jason Campbell","Ladell Betts","Ryan Torain","Keiland Williams","Quinton Ganther","Anthony Armstrong","Devin Thomas","Malcolm Kelly","Fred Davis","Shaun Hill","Matthew Stafford","Dan Orlovsky","Kevin Smith","Jahvid Best","Maurice Morris","Calvin Johnson","Mike Furrey","Brandon Pettigrew","Will Heller","Rex Grossman","Matt Forte","Cedric Benson","Bernard Berrian","Johnny Knox","Devin Hester","Earl Bennett","Rashied Davis","Devin Aromashodu","Greg Olsen","Vince Young","Chris Johnson","LenDale White","Javon Ringer","Kenny Britt","Roydell Williams","Nate Washington","Justin Gage","Bobby Wade","Jared Cook","DeAngelo Williams","Jonathan Stewart","Mike Goodson","Drew Carter","David Gettis","Brandon LaFell","Jeff King","Dante Rosario","Gary Barnidge","Aaron Rodgers","Ryan Grant","Brandon Jackson","John Kuhn","Noah Herron","Greg Jennings","James Jones","Jordy Nelson","Ruvell Martin","Jermichael Finley","Matt Ryan","Chris Redman","Jerious Norwood","Jason Snelling","Justin Griffith","Harry Douglas","Seneca Wallace","Justin Forsett","Marshawn Lynch","Leonard Weaver","Mike Williams","Ben Obomanu","John Carlson","Tyler Thigpen","Jamaal Charles","Kolby Smith","Dwayne Bowe","Mark Bradley","Jeff Webb","Tony Moeaki","Kris Wilson","Leonard Pope","Joseph Addai","Kenton Keith","Donald Brown","Javarris James","Pierre Garcon","Austin Collie","Anthony Gonzalez","Blair White","Jacob Tamme","Ben Utecht","Derek Anderson","Charlie Frye","Colt McCoy","Brady Quinn","Jerome Harrison","Jason Wright","Mohamed Massaquoi","Josh Cribbs","Brian Robiskie","Chansi Stuckey","Evan Moore","Reggie Bush","Pierre Thomas","Chris Ivory","Marques Colston","Lance Moore","Robert Meachem","Devery Henderson","Terrance Copper","Jimmy Graham","Matt Leinart","Tim Hightower","Chris Wells","LaRod Stephens-Howling","Steve Breaston","Jerheme Urban","Andre Roberts","Early Doucet","Ben Patrick","Tarvaris Jackson","Adrian Peterson","Toby Gerhart","Sidney Rice","Percy Harvin","Troy Williamson","Visanthe Shiancoe","Ryan Fitzpatrick","Bernard Scott","Jordan Shipley","Andre Caldwell","Jerome Simpson","Jermaine Gresham","J.P. Foschi","Joe Flacco","Ray Rice","Le'Ron McClain","Musa Smith","Ovie Mughelli","Demetrius Williams","Devard Darling","Quinn Sypniewski","Philip Rivers","Mike Tolbert","Darren Sproles","Ryan Mathews","Lorenzo Neal","Vincent Jackson","Malcom Floyd","Legedu Naanee","Craig Davis","LeSean McCoy","DeSean Jackson","Jeremy Maclin","Jason Avant","Hank Baskett","Brent Celek","JaMarcus Russell","Darren McFadden","Justin Fargas","Michael Bush","Marcel Reece","Jacoby Ford","Louis Murphy","Johnnie Lee Higgins","Chaz Schilens","Darrius Heyward-Bey","Zach Miller","Randal Williams","Matt Schaub","Sage Rosenfels","Arian Foster","Steve Slaton","Wali Lundy","Ryan Moats","Kevin Walter","Jacoby Jones","David Anderson","Owen Daniels","Joel Dreessen","J.P. Losman","Trent Edwards","Fred Jackson","C.J. Spiller","Steve Johnson","Roscoe Parrish","David Nelson","Donald Jones","Robert Royal","Shawn Nelson","Derek Schouman","Quinn Gray","Maurice Jones-Drew","Rashad Jennings","Mike Sims-Walker","Mike Thomas","Marcedes Lewis","Zach Miller","Rashard Mendenhall","Isaac Redman","Mike Wallace","Santonio Holmes","Emmanuel Sanders","Mark Sanchez","Kellen Clemens","Leon Washington","Shonn Greene","Jerricho Cotchery","Brad Smith","Dustin Keller","Alex Smith","J.T. O'Sullivan","Troy Smith","Glen Coffee","Michael Crabtree","Josh Morgan","Jason Hill","Vernon Davis","Delanie Walker","Eddie Lacy","James Starks","Alex Green","Randall Cobb","Jarrett Boykin","Davante Adams","Richard Rodgers","Andrew Quarless","Tom Crabtree","Devonta Freeman","Jacquizz Rodgers","Antone Smith","Julio Jones","Leonard Hankerson","Darius Johnson","Drew Davis","Levine Toilolo","Marcus Mariota","Jake Locker","Antonio Andrews","Bishop Sankey","Kendall Wright","Damian Williams","Dorial Green-Beckham","Lavelle Hawkins","Justin Hunter","Dexter McCluster","Craig Stevens","Le'Veon Bell","Jonathan Dwyer","Antonio Brown","Martavis Bryant","Markus Wheaton","Javorius Allen","Kyle Juszczyk","Bernard Pierce","Torrey Smith","Kamar Aiken","Marlon Brown","Jeremy Butler","Chris Givens","Dennis Pitta","Ed Dickson","Crockett Gillmore","Stevan Ridley","Shane Vereen","Dion Lewis","Julian Edelman","Aaron Dobson","Kenbrell Thompkins","Timothy Wright","Scott Chandler","Charcandrick West","Knile Davis","Spencer Ware","Jackie Battle","Shaun Draughn","Albert Wilson","De'Anthony Thomas","Jon Baldwin","Travis Kelce","Sean McGrath","Geno Smith","Bilal Powell","Eric Decker","Jeremy Kerley","Jeff Cumberland","Jace Amaro","Nick Foles","DeMarco Murray","Bryce Brown","Chris Polk","Riley Cooper","Josh Huff","Nelson Agholor","Damaris Johnson","Jordan Matthews","Zach Ertz","Clay Harbor","Cam Newton","Kelvin Benjamin","Devin Funchess","Corey Brown","Robert Griffin III","Kirk Cousins","Alfred Morris","Roy Helu","Matt Jones","Chris Thompson","Evan Royster","Jamison Crowder","Jordan Reed","Niles Paul","Logan Paulsen","Andrew Luck","Curtis Painter","Vick Ballard","Trent Richardson","Dan Herron","T.Y. Hilton","Donte Moncrief","Coby Fleener","Dwayne Allen","Kevin Kolb","Drew Stanton","John Skelton","David Johnson","Andre Ellington","John Brown","Michael Floyd","Jaron Brown","J.J. Nelson","Rob Housler","Darren Fells","Mark Ingram","Travaris Cadet","Brandin Cooks","Willie Snead","Kenny Stills","Brandon Coleman","Josh Hill","David Thomas","Joique Bell","Theo Riddick","Mikel Leshoure","Ameer Abdullah","Golden Tate","Titus Young","Kris Durham","Ryan Broyles","Jeremy Ross","Eric Ebron","Joseph Fauria","Branden Oliver","Melvin Gordon","Keenan Allen","Danario Alexander","Dontrelle Inman","Vincent Brown","Ladarius Green","Joseph Randle","Lance Dunbar","Terrance Williams","Cole Beasley","Kevin Ogletree","Dwayne Harris","Gavin Escobar","Jameis Winston","Mike Glennon","Doug Martin","Charles Sims","Bobby Rainey","Kregg Lumpkin","Mike Evans","Preston Parker","Dezmon Briscoe","Tiquan Underwood","Austin Seferian-Jenkins","Brian Hoyer","Case Keenum","Ben Tate","Alfred Blue","Jonathan Grimes","DeAndre Hopkins","Cecil Shorts","Keshawn Martin","Garrett Graham","James Casey","Teddy Bridgewater","Christian Ponder","Matt Asiata","Cordarrelle Patterson","Jerick McKinnon","Stefon Diggs","Jarius Wright","Charles D. Johnson","Kyle Rudolph","Chase Ford","Brock Osweiler","C.J. Anderson","Ronnie Hillman","Montee Ball","Lance Ball","Matt Willis","Julius Thomas","Austin Davis","Todd Gurley","Zac Stacy","Tre Mason","Benny Cunningham","Daryl Richardson","Tavon Austin","Austin Pettis","Stedman Bailey","Lance Kendricks","Cory Harkey","Andre Williams","Andre Brown","Odell Beckham Jr.","Victor Cruz","Rueben Randle","Larry Donnell","Brandon Myers","Jake Ballard","Jeremy Langford","Kahlil Bell","Alshon Jeffery","Marquess Wilson","Dane Sanzenbacher","Kellen Davis","Brandon Weeden","Duke Johnson","Isaiah Crowell","Chris Ogbonnaya","Terrance West","Josh Gordon","Travis Benjamin","Andrew Hawkins","Greg Little","Taylor Gabriel","Jordan Cameron","Colin Kaepernick","Blaine Gabbert","Kendall Hunter","Carlos Hyde","Bruce Miller","Quinton Patton","Kyle Williams","Vance McDonald","Garrett Celek","Andy Dalton","Jeremy Hill","Giovani Bernard","Cedric Peerman","A.J. Green","Marvin Jones","Mohamed Sanu","Tyler Eifert","Russell Wilson","Thomas Rawls","Robert Turbin","Doug Baldwin","Tyler Lockett","Jermaine Kearse","Paul Richardson","Luke Willson","Anthony McCoy","Derek Carr","Matt McGloin","Latavius Murray","Amari Cooper","Rod Streater","Denarius Moore","Terrelle Pryor","Andre Holmes","Mychal Rivera","Clive Walford","Tyrod Taylor","EJ Manuel","Karlos Williams","Anthony Dixon","Mike Gillislee","Sammy Watkins","Robert Woods","Chris Hogan","Trevor Graham","Charles Clay","Blake Bortles","T.J. Yeldon","Denard Robinson","Jordan Todman","Allen Robinson","Allen Hurns","Justin Blackmon","Ace Sanders","Mike Brown","Marqise Lee","Ryan Tannehill","Matt Moore","Lamar Miller","Daniel Thomas","Damien Williams","Jarvis Landry","Rishard Matthews","DeVante Parker","Dion Sims","Lamar Jackson","J.K. Dobbins","Alex Collins","Gus Edwards","Marquise Brown","Breshad Perriman","Mark Andrews","Hayden Hurst","Alvin Kamara","Michael Thomas","Tre'Quan Smith","Deonte Harty","Taysom Hill","Kyler Murray","Josh Rosen","Kenyan Drake","Chase Edmonds","Kerwynn Williams","Christian Kirk","Damiere Byrd","Dan Arnold","Ricky Seals-Jones","Justin Herbert","Austin Ekeler","Joshua Kelley","Kalen Ballage","Justin Jackson","Tyrell Williams","Mike Williams","Jalen Guyton","Tyron Johnson","Hunter Henry","Virgil Green","Donald Parham","D'Andre Swift","Kerryon Johnson","Zach Zenner","Kenny Golladay","T.J. Jones","Quintez Cephus","Marvin Hall","T.J. Hockenson","Dak Prescott","Ezekiel Elliott","Tony Pollard","Rod Smith","CeeDee Lamb","Michael Gallup","Brice Butler","Dalton Schultz","Blake Jarwin","Geoff Swaim","Daniel Jones","Saquon Barkley","Wayne Gallman","Orleans Darkwa","Paul Perkins","Sterling Shepard","Darius Slayton","Roger Lewis","Cody Latimer","Tavarres King","Evan Engram","Will Tye","Kaden Smith","Rhett Ellison","Mason Rudolph","James Conner","Jaylen Samuels","Benny Snell","JuJu Smith-Schuster","Diontae Johnson","Chase Claypool","James Washington","Eli Rogers","Sammie Coates","Jesse James","Patrick Mahomes","Kareem Hunt","Clyde Edwards-Helaire","Tyreek Hill","Mecole Hardman","Demarcus Robinson","Chris Conley","Demetrius Harris","Brett Hundley","Aaron Jones","Jamaal Williams","Aaron Ripkowski","Ty Montgomery","Marquez Valdes-Scantling","Allen Lazard","Geronimo Allison","Equanimeous St. Brown","Robert Tonyan","Jacoby Brissett","Jonathan Taylor","Nyheim Hines","Marlon Mack","Jordan Wilkins","Zach Pascal","Chester Rogers","Michael Pittman","Phillip Dorsett","Ryan Grant","Jack Doyle","Trey Burton","Carson Wentz","Jalen Hurts","Miles Sanders","Wendell Smallwood","Jordan Howard","Greg Ward","Travis Fulgham","Jalen Reagor","Dallas Goedert","Sam Darnold","Elijah McGuire","Robbie Chosen","Quincy Enunwa","Braxton Berrios","Chris Herndon","Ryan Griffin","Dwayne Haskins","Antonio Gibson","J.D. McKissic","Rob Kelley","Samaje Perine","Terry McLaurin","Josh Doctson","Steven Sims","Cam Sims","Logan Thomas","Jeremy Sprinkle","Gardner Minshew","Leonard Fournette","James Robinson","Ryquell Armstead","DJ Chark","Dede Westbrook","Laviska Shenault Jr.","Keelan Cole","James O'Shaughnessy","Derrick Henry","A.J. Brown","Corey Davis","Tajae Sharpe","Taywan Taylor","Adam Humphries","Jonnu Smith","Anthony Firkser","Luke Stocker","Kyle Allen","Christian McCaffrey","Mike Davis","Fozzy Whittaker","DJ Moore","Curtis Samuel","Ian Thomas","James White","Sony Michel","Rex Burkhead","Damien Harris","Jakobi Meyers","N'Keal Harry","Tevin Coleman","Brian Hill","Ito Smith","Calvin Ridley","Russell Gage","Justin Hardy","Aldrick Robinson","Olamide Zaccheaus","Austin Hooper","Mitchell Trubisky","Matt Barkley","David Montgomery","Tarik Cohen","Cameron Meredith","Darnell Mooney","Anthony Miller","Cole Kmet","Baker Mayfield","DeShone Kizer","Cody Kessler","Nick Chubb","Antonio Callaway","Rashard Higgins","Corey Coleman","Ricardo Louis","David Njoku","Seth DeValve","Josh Jacobs","Jalen Richard","DeAndre Washington","Hunter Renfrow","Seth Roberts","Henry Ruggs III","Darren Waller","Foster Moreau","Jared Goff","Darrell Henderson","Malcolm Brown","Cam Akers","Cooper Kupp","Josh Reynolds","Brian Quick","Tyler Higbee","Gerald Everett","Josh Allen","Devin Singletary","Zack Moss","Zay Jones","Gabe Davis","Isaiah McKenzie","Robert Foster","Dawson Knox","Nick O'Leary","Joe Burrow","Jeff Driskel","Joe Mixon","Tyler Boyd","Tee Higgins","Auden Tate","Alex Erickson","John Ross","Tyler Kroft","C.J. Uzomah","Drew Sample","Trevor Siemian","Drew Lock","Phillip Lindsay","Royce Freeman","Devontae Booker","Courtland Sutton","Tim Patrick","Jerry Jeudy","KJ Hamler","Bennie Fowler","DaeSean Hamilton","Noah Fant","Jeff Heuerman","Matt LaCosse","Chris Carson","Christine Michael","Rashaad Penny","DK Metcalf","David Moore","Malik Turner","Jacob Hollister","Nick Vannett","Will Dissly","Jimmy Garoppolo","Nick Mullens","C.J. Beathard","Raheem Mostert","Matt Breida","Jeff Wilson","Deebo Samuel Sr.","Brandon Aiyuk","Marquise Goodwin","Kendrick Bourne","Dante Pettis","Trent Taylor","George Kittle","Dalvin Cook","Alexander Mattison","Adam Thielen","Justin Jefferson","Bisi Johnson","Laquon Treadwell","Chad Beebe","Irv Smith","Tyler Conklin","Ronald Jones","Peyton Barber","Dare Ogunbowale","Chris Godwin Jr.","Scott Miller","Russell Shepard","Cameron Brate","O.J. Howard","Deshaun Watson","D'Onta Foreman","Will Fuller","Keke Coutee","Bruce Ellington","C.J. Fiedorowicz","Jordan Akins","Tua Tagovailoa","Jay Ajayi","Myles Gaskin","Salvon Ahmed","Preston Williams","Jakeem Grant","Mike Gesicki","Durham Smythe","Bucky Irving","Rachaad White","Sean Tucker","Emeka Egbuka","Jalen McMillan","Trey Palmer","Tez Johnson","Cade Otton","Kenny Pickett","Najee Harris","Kenny Gainwell","Jaylen Warren","George Pickens","Calvin Austin III","Ray-Ray McCloud","Van Jefferson","Pat Freiermuth","Darnell Washington","Zach Gentry","Jordan Love","AJ Dillon","Emanuel Wilson","Jayden Reed","Romeo Doubs","Christian Watson","Dontayvion Wicks","Tucker Kraft","Luke Musgrave","Josiah Deguara","C.J. Stroud","Davis Mills","Dameon Pierce","Woody Marks","Nico Collins","Tank Dell","Jayden Higgins","Chris Moore","Noah Brown","Xavier Hutchinson","Brevin Jordan","Pharaoh Brown","Desmond Ridder","Bijan Robinson","Tyler Allgeier","Drake London","David Sills","Kyle Pitts","MyCole Pruitt","Kyren Williams","Blake Corum","Puka Nacua","Tutu Atwell","Colby Parkinson","Davis Allen","Terrance Ferguson","Omarion Hampton","Kimani Vidal","Ladd McConkey","Quentin Johnston","Josh Palmer","DeAndre Carter","Tre Harris","Oronde Gadsden II","James Cook","Ray Davis","Ty Johnson","Khalil Shakir","Keon Coleman","Mack Hollins","Dalton Kincaid","Jackson Hawes","Caleb Williams","Justin Fields","Kyle Monangai","Khalil Herbert","Roschon Johnson","Rome Odunze","Luther Burden III","Colston Loveland","Joshua Dobbs","Michael Carter","Eno Benjamin","Bam Knight","Emari Demercado","Michael Wilson","Marvin Harrison Jr.","Greg Dortch","Rondale Moore","Trey McBride","Elijah Higgins","Maxx Williams","Cam Ward","Will Levis","Tyjae Spears","Dontrell Hilliard","Jeremy McNichols","Nick Westbrook-Ikhine","Chimere Dike","Elic Ayomanor","Treylon Burks","Chig Okonkwo","Gunnar Helm","Jaxson Dart","Tommy DeVito","Tyrone Tracy Jr.","Cam Skattebo","Malik Nabers","Wan'Dale Robinson","Richie James","Isaiah Hodgins","Kadarius Toney","Theo Johnson","Daniel Bellinger","Drake Maye","Mac Jones","Rhamondre Stevenson","TreVeyon Henderson","Brandon Bolden","DeMario Douglas","Kayshon Boutte","Kenneth Walker III","Zach Charbonnet","Travis Homer","DeeJay Dallas","Jaxon Smith-Njigba","Freddie Swain","Tory Horton","Jake Bobo","AJ Barner","Trevor Lawrence","Travis Etienne","Tank Bigsby","Bhayshul Tuten","JaMycal Hasty","Brian Thomas Jr.","Parker Washington","Brenton Strange","J.J. McCarthy","Jordan Mason","Ty Chandler","Jordan Addison","K.J. Osborn","Jalen Nailor","Brandon Powell","Josh Oliver","Brock Purdy","Elijah Mitchell","Isaac Guerendo","Jauan Jennings","Ricky Pearsall","Jake Tonges","Boston Scott","DeVonta Smith","Quez Watkins","Jahan Dotson","Grant Calcaterra","Zach Wilson","Breece Hall","Braelon Allen","Isaiah Davis","Garrett Wilson","Elijah Moore","Mason Taylor","Deon Jackson","Trey Sermon","Josh Downs","Alec Pierce","Parris Campbell","Adonai Mitchell","Ashton Dulin","Tyler Warren","Mo Alie-Cox","Jelani Woods","Isiah Pacheco","Darrel Williams","Rashee Rice","Xavier Worthy","Byron Pringle","Noah Gray","Tyler Huntley","Justice Hill","Zay Flowers","Rashod Bateman","Devin Duvernay","Isaiah Likely","Charlie Kolar","De'Von Achane","Jaylen Wright","Jaylen Waddle","Malik Washington","Trent Sherfield","Cedrick Wilson Jr.","Bo Nix","Javonte Williams","RJ Harvey","Troy Franklin","Marvin Mims Jr.","Devaughn Vele","Pat Bryant","Brandon Johnson","Greg Dulcich","Albert Okwuegbunam","Jayden Daniels","Sam Howell","Taylor Heinicke","Brian Robinson","Jacory Croskey-Merritt","Chris Rodriguez Jr.","John Bates","Aidan O'Connell","Ashton Jeanty","Zamir White","Tre Tucker","Bryan Edwards","Brock Bowers","Michael Mayer","Jerome Ford","Quinshon Judkins","D'Ernest Johnson","Dylan Sampson","Donovan Peoples-Jones","Cedric Tillman","Isaiah Bond","Harold Fannin Jr.","Tyler Shough","Devin Neal","Audric Estimé","Chris Olave","Rashid Shaheed","Marquez Callaway","Juwan Johnson","Adam Trautman","Cooper Rush","Rico Dowdle","Jalen Tolbert","Ryan Flournoy","Jake Ferguson","Luke Schoonmaker","Peyton Hendershot","Jake Browning","Chase Brown","Chris Evans","Ja'Marr Chase","Andrei Iosivas","Trenton Irwin","Tanner Hudson","Jahmyr Gibbs","Amon-Ra St. Brown","Jameson Williams","Kalif Raymond","Isaac TeSlaa","Sam LaPorta","Brock Wright","Shane Zylstra","Bryce Young","Chuba Hubbard","Tetairoa McMillan","Xavier Legette","Jalen Coker","Ja'Tavion Sanders","Tommy Tremble","Mitchell Evans"],"b":{"DAL|0":[[0,0,2005,16,300,499,3639,23,17,34,50,2,0,0,0,8,206.6,78.0],[1,0,2003,16,291,505,3302,17,21,68,257,2,0,0,0,3,189.8,67.1],[2,0,2004,16,297,495,3532,17,20,21,38,1,0,0,0,3,175.1,64.1],[3,0,1999,14,264,442,2964,17,12,21,10,1,0,0,0,0,169.6,63.4],[4,1,1999,15,0,0,0,0,0,329,1397,11,27,119,2,3,250.6,79.0],[5,1,2003,15,0,1,0,0,0,70,306,1,69,493,4,0,178.9,56.3],[6,1,2005,13,0,0,0,0,0,257,993,5,35,218,0,2,182.1,55.3],[7,1,2003,16,0,0,0,0,0,275,972,5,17,99,0,3,148.1,42.5],[8,1,2005,13,0,0,0,0,0,138,538,5,18,115,0,0,113.3,34.4],[9,1,2000,12,0,0,0,0,0,59,254,2,31,302,1,0,104.6,33.0],[10,2,1999,16,0,0,0,0,0,13,110,1,80,1097,6,1,240.7,83.9],[11,2,2005,16,0,0,0,0,0,2,-4,1,62,1136,7,0,223.2,77.8],[12,2,2004,16,0,2,0,0,1,2,13,0,70,981,6,1,201.4,70.2],[13,2,2002,16,0,0,0,0,0,4,31,0,61,908,6,1,188.9,65.9],[14,2,2000,16,0,0,0,0,0,0,0,0,52,926,2,1,154.6,53.9],[15,2,2002,16,0,0,0,0,0,6,40,0,44,733,6,2,153.3,53.5],[16,2,1999,15,0,0,0,0,0,1,8,0,23,439,2,0,79.7,27.8],[17,2,2000,14,0,0,0,0,0,6,49,1,25,250,0,0,72.9,25.4],[18,3,2004,16,0,0,0,0,0,0,0,0,87,980,6,1,221.0,125.4],[19,3,1999,16,0,0,0,0,0,0,0,0,35,322,7,0,109.2,61.9],[20,3,2000,16,0,0,0,0,0,0,0,0,39,306,5,0,101.6,57.6],[21,3,2002,13,0,0,0,0,0,0,0,0,23,294,1,0,58.4,33.1]],"KC|0":[[22,0,2004,16,369,556,4591,27,17,25,85,0,0,0,0,4,260.1,103.6],[23,0,2000,15,326,547,4169,28,14,30,110,1,0,0,0,3,261.8,100.0],[24,1,2002,14,0,1,0,0,0,313,1615,21,70,672,3,1,440.7,130],[25,1,2005,16,0,0,0,0,0,336,1750,20,33,343,1,4,360.3,119.4],[26,1,2000,16,0,0,0,0,0,147,697,3,58,468,3,2,206.5,67.4],[27,1,2004,12,0,0,0,0,0,118,539,8,25,246,1,0,157.5,50.9],[28,1,1999,13,0,0,0,0,0,161,627,8,10,41,0,1,122.8,37.2],[29,1,2000,15,0,0,0,0,0,76,331,2,15,76,0,0,67.7,21.8],[30,2,2000,16,0,0,0,0,0,3,45,0,78,1391,10,0,281.6,98.2],[31,2,2004,14,0,0,0,0,0,2,15,0,62,1086,8,0,222.1,77.5],[32,2,2003,15,0,0,0,0,0,8,94,0,50,740,4,0,157.4,54.9],[33,2,1999,15,0,0,0,0,0,2,15,0,35,586,6,0,131.1,45.7],[34,2,2000,15,1,1,31,0,0,0,0,0,48,678,3,3,129.0,45.0],[35,2,2003,16,0,0,0,0,0,16,73,0,40,423,1,2,115.6,40.3],[36,2,2002,15,0,0,0,0,0,0,0,0,20,420,8,0,110.0,38.4],[37,2,2005,11,0,0,0,0,0,0,0,0,36,533,3,2,103.3,36.0],[38,3,2004,16,0,0,0,0,0,1,5,0,102,1258,7,0,270.3,130],[39,3,2001,11,0,0,0,0,0,0,0,0,18,252,1,0,49.2,27.9],[40,3,2004,11,0,0,0,0,0,0,0,0,17,120,3,0,47.0,26.7]],"WAS|0":[[41,0,1999,16,316,519,4005,24,13,26,31,2,0,0,0,6,235.3,90.7],[42,0,2005,16,262,454,3050,23,10,42,111,0,0,0,0,6,195.1,73.4],[43,0,2001,15,198,370,2386,10,10,47,152,2,0,0,0,4,136.6,45.9],[44,0,2003,11,179,337,2166,14,9,15,62,1,0,0,0,5,130.8,44.9],[45,1,1999,14,0,0,0,0,0,290,1405,17,23,111,0,1,276.6,91.0],[46,1,2005,16,1,2,17,1,0,352,1516,11,30,216,0,2,271.9,86.1],[47,1,2000,15,0,0,0,0,0,19,103,0,81,600,3,0,169.3,53.4],[48,1,2002,16,0,0,0,0,0,116,534,1,32,253,1,1,120.7,39.5],[49,1,1999,16,0,0,0,0,0,40,220,1,31,305,0,0,89.5,29.7],[50,1,2003,15,0,0,0,0,0,107,411,4,18,176,0,2,96.7,29.3],[51,2,2005,16,0,0,0,0,0,3,-3,0,84,1483,9,1,284.0,99.0],[52,2,2003,16,0,0,0,0,0,10,39,0,82,1204,6,0,242.3,84.5],[53,2,1999,16,0,0,0,0,0,7,35,0,65,1191,9,1,241.6,84.3],[54,2,2002,16,0,1,0,0,0,1,1,0,71,1006,8,0,219.7,76.6],[55,2,1999,15,0,0,0,0,0,1,8,0,62,1132,7,1,216.0,75.3],[56,2,2002,16,0,0,0,0,0,10,77,0,53,773,4,2,158.0,55.1],[57,2,2000,16,0,0,0,0,0,10,82,0,50,653,2,1,133.5,46.6],[58,2,2000,14,0,0,0,0,0,2,16,0,41,548,5,0,127.4,44.4],[59,3,2005,16,0,0,0,0,0,0,0,0,71,774,7,1,188.4,106.9],[60,3,2000,16,0,0,0,0,0,0,0,0,47,510,2,1,108.0,61.3],[61,3,2005,12,0,0,0,0,0,1,1,1,12,72,7,0,67.3,38.2],[62,3,2001,15,0,0,0,0,0,0,0,0,18,196,2,0,49.6,28.1]],"NE|0":[[63,0,2005,16,334,530,4110,26,14,27,89,1,0,0,0,3,249.3,97.4],[0,0,1999,16,306,539,3985,19,21,42,101,0,0,0,0,2,199.5,71.7],[64,1,2004,15,0,0,0,0,0,345,1635,12,15,103,1,4,260.8,85.4],[65,1,2001,16,0,0,0,0,0,287,1157,12,19,192,1,4,223.9,69.3],[66,1,2000,16,0,0,0,0,0,164,570,4,51,465,1,4,178.5,52.3],[67,1,1999,16,0,0,0,0,0,254,896,8,14,125,1,4,162.1,46.8],[68,1,2005,10,0,0,0,0,0,54,245,3,22,227,0,1,85.2,27.3],[69,1,2000,11,0,0,0,0,0,125,406,1,20,126,2,0,91.2,25.0],[70,2,2001,16,0,0,0,0,0,11,91,0,101,1199,5,1,270.0,94.2],[11,2,2000,16,0,0,0,0,0,4,39,0,79,963,6,0,215.2,75.1],[71,2,2005,16,0,0,0,0,0,0,0,0,78,998,5,0,207.8,72.5],[72,2,2002,16,0,1,0,0,0,2,6,0,61,824,5,0,174.0,60.7],[73,2,2004,15,0,0,0,0,0,0,0,0,56,874,3,0,161.4,56.3],[74,2,1999,16,0,0,0,0,0,0,0,0,40,698,6,0,145.8,50.8],[75,2,2005,16,0,0,0,0,0,4,11,0,19,332,3,0,71.3,24.9],[76,2,1999,13,0,0,0,0,0,0,0,0,19,276,2,0,58.6,20.4],[77,3,2004,13,0,0,0,0,0,0,0,0,30,364,7,0,108.4,61.5],[78,3,2002,15,0,0,0,0,0,0,0,0,27,253,7,0,96.3,54.6],[79,3,2005,14,0,0,0,0,0,0,0,0,29,441,4,1,95.1,53.9],[80,3,1999,15,0,0,0,0,0,0,0,0,32,370,2,0,81.0,45.9]],"TB|0":[[41,0,2003,16,354,570,3811,26,21,25,33,0,0,-2,0,2,215.5,81.4],[81,0,2000,16,233,428,2769,18,13,73,353,5,0,0,0,1,222.1,79.2],[82,0,2004,11,233,336,2632,20,12,30,17,0,1,-4,0,4,155.6,66.6],[83,0,2005,11,191,313,2035,10,7,19,31,0,1,-3,0,4,103.2,39.3],[84,1,2000,16,0,0,0,0,0,248,1133,8,44,422,1,1,251.5,81.4],[85,1,2004,13,0,0,0,0,0,219,926,7,41,391,3,6,220.7,69.6],[86,1,2001,16,0,0,0,0,0,165,680,10,35,231,1,2,192.1,60.0],[87,1,2005,14,0,0,0,0,0,290,1178,6,20,81,0,2,177.9,55.2],[88,1,2003,15,0,0,0,0,0,137,627,3,24,180,0,2,118.7,39.2],[13,2,2005,14,0,0,0,0,0,2,4,0,83,1287,10,0,272.1,94.9],[89,2,2003,16,0,0,0,0,0,0,0,0,84,1174,8,1,247.4,86.3],[90,2,2004,16,0,0,0,0,0,5,30,0,80,1193,7,0,244.3,85.2],[12,2,2001,15,0,0,0,0,0,0,0,0,106,1266,1,1,236.6,82.5],[91,2,1999,16,0,0,0,0,0,3,8,0,56,791,3,1,151.9,53.0],[92,2,2002,13,0,0,0,0,0,0,0,0,37,423,4,0,103.3,36.0],[93,2,2003,7,0,0,0,0,0,2,14,0,33,432,2,0,89.6,31.2],[94,2,2005,13,0,0,0,0,0,0,0,0,35,282,1,0,69.2,24.1],[95,3,2004,15,0,0,0,0,0,0,0,0,39,345,3,0,93.5,53.0],[96,3,2005,16,0,0,0,0,0,0,0,0,41,367,2,0,89.7,50.9],[97,3,2001,14,0,0,0,0,0,0,0,0,35,285,4,0,87.5,49.6],[98,3,2002,13,0,0,0,0,0,0,0,0,16,192,3,0,53.2,30.2]],"ATL|0":[[99,0,2002,15,231,421,2936,16,8,113,777,8,0,16,0,6,280.7,102.8],[100,0,2001,14,223,365,2847,16,14,25,84,0,0,0,0,1,158.3,60.5],[101,0,2003,10,136,243,1655,8,12,14,21,1,0,0,0,0,82.3,26.5],[84,1,2005,16,0,0,0,0,0,280,1416,3,29,220,1,1,214.6,73.2],[102,1,2000,16,0,0,0,0,0,282,1024,6,42,382,0,4,212.6,63.2],[103,1,2003,16,0,1,0,0,0,197,779,11,11,94,0,2,160.3,49.1],[104,1,2001,16,0,0,0,0,0,44,284,2,45,392,2,0,136.6,45.9],[105,1,2001,15,0,0,0,0,0,237,760,5,19,230,1,1,152.0,41.6],[106,1,1999,12,0,0,0,0,0,141,452,1,17,172,1,4,83.4,21.9],[107,2,1999,16,0,0,0,0,0,1,0,0,81,1016,6,0,218.6,76.2],[108,2,2002,16,0,0,0,0,0,0,0,0,56,838,6,1,173.8,60.6],[109,2,2003,16,0,0,0,0,0,2,3,0,64,838,3,0,166.1,57.9],[75,2,1999,12,0,0,0,0,0,5,28,1,32,669,7,0,155.7,54.3],[74,2,2000,15,0,0,0,0,0,1,1,0,60,822,2,0,154.3,53.8],[110,2,2001,11,0,0,0,0,0,0,0,0,37,548,3,0,109.8,38.3],[111,2,2005,14,0,0,0,0,0,0,0,0,36,508,3,1,102.8,35.9],[112,2,2005,14,0,0,0,0,0,4,12,0,29,446,3,1,90.8,31.7],[113,3,2005,16,0,0,0,0,0,0,0,0,65,877,5,1,182.7,103.6],[114,3,2000,15,0,0,0,0,0,0,0,0,31,340,2,1,75.0,42.5],[115,3,2001,14,0,0,0,0,0,0,0,0,15,270,1,0,48.0,27.2]],"NYJ|0":[[116,0,2002,15,275,399,3120,22,6,29,49,2,0,0,0,1,217.7,91.4],[2,0,2000,16,328,590,3732,21,25,25,32,0,0,0,0,4,182.5,63.0],[117,0,1999,9,162,272,1678,14,6,41,144,1,0,0,0,2,127.5,48.8],[118,0,2005,11,150,266,1558,7,6,35,135,0,0,0,0,1,89.8,30.4],[119,1,2004,16,0,0,0,0,0,371,1697,12,41,245,2,0,319.2,102.5],[5,1,2000,16,0,0,0,0,0,27,63,0,88,853,2,2,187.6,56.8],[120,1,2003,16,0,0,0,0,0,1,2,0,47,436,1,0,96.8,30.0],[121,1,2004,16,0,1,0,0,1,93,479,2,15,112,0,0,84.1,29.4],[122,1,2005,10,0,0,0,0,0,81,302,2,8,66,0,1,54.8,16.1],[12,2,1999,16,0,1,0,0,0,5,6,0,89,1170,8,0,254.6,88.8],[52,2,2002,16,0,0,0,0,0,6,39,0,89,1264,5,0,251.3,87.6],[51,2,2003,16,0,0,0,0,0,10,67,0,74,1105,10,2,247.2,86.2],[123,2,2000,16,0,0,0,0,0,3,-3,0,69,937,8,0,210.4,73.4],[124,2,2004,16,0,0,0,0,0,2,-5,0,56,770,4,0,156.5,54.6],[125,2,2000,16,0,0,0,0,0,4,23,0,54,801,3,1,152.4,53.2],[126,2,2003,16,0,0,0,0,0,0,0,0,46,640,2,0,122.0,42.5],[127,3,2003,15,0,0,0,0,0,0,0,0,40,356,4,0,101.6,57.6],[128,3,2005,11,0,0,0,0,0,0,0,0,29,324,1,1,65.4,37.1],[129,3,2004,13,0,0,0,0,0,0,0,0,18,182,4,1,58.2,33.0]],"NYG|0":[[130,0,2002,16,335,545,4073,19,14,44,-3,0,0,0,0,1,210.6,80.4],[131,0,2005,16,293,557,3762,24,17,29,80,1,0,0,0,2,224.5,79.4],[132,0,2004,10,174,277,2054,6,4,13,30,1,0,0,0,4,99.2,39.7],[133,0,1999,9,160,271,1697,9,9,35,132,1,1,-1,0,0,106.0,37.8],[134,1,2005,16,0,1,0,0,0,357,1860,9,54,530,2,1,359.0,119.0],[135,1,2001,16,0,0,0,0,0,180,690,7,8,67,0,1,125.7,37.7],[136,1,2001,16,0,0,0,0,0,4,15,0,39,253,1,0,71.8,22.3],[137,1,2005,15,0,0,0,0,0,38,99,7,0,0,0,1,49.9,13.7],[138,1,2003,11,0,0,0,0,0,68,197,3,5,39,0,0,46.6,11.9],[139,1,1999,6,0,0,0,0,0,115,348,3,0,0,0,2,50.8,11.9],[140,2,2002,16,0,0,0,0,0,1,2,0,82,1343,8,0,264.5,92.2],[141,2,2005,16,0,0,0,0,0,0,0,0,76,1214,7,1,237.4,82.8],[94,2,1999,16,0,0,0,0,0,3,16,0,72,996,3,0,191.2,66.7],[92,2,2001,14,0,0,0,0,0,0,0,0,51,706,3,0,139.6,48.7],[142,2,2002,10,0,0,0,0,0,0,0,0,22,377,2,1,69.7,24.3],[143,2,2003,10,0,0,0,0,0,0,0,0,26,309,0,0,56.9,19.8],[144,3,2005,15,0,0,0,0,0,0,0,0,65,891,7,0,198.1,112.4],[145,3,1999,15,0,0,0,0,0,0,0,0,58,520,3,1,126.0,71.5],[146,3,2002,15,0,0,0,0,0,0,0,0,22,175,1,0,45.5,25.8]],"DET|0":[[147,0,2004,16,274,489,3047,19,12,48,175,0,0,0,0,3,187.4,67.5],[148,0,1999,11,152,270,1957,13,7,28,87,2,0,0,0,1,137.0,50.9],[149,0,1999,9,175,288,2117,9,7,15,33,0,0,0,0,0,112.0,43.0],[150,0,2002,8,62,147,874,7,9,14,96,3,1,7,0,1,74.3,20.4],[151,1,2000,16,0,0,0,0,0,339,1184,10,32,287,1,2,247.1,73.0],[152,1,2004,15,0,0,0,0,0,241,1133,5,28,180,1,1,193.3,64.2],[153,1,2003,16,0,0,0,0,0,158,606,3,54,340,0,1,164.6,49.9],[154,1,2001,16,0,0,0,0,0,47,154,3,60,466,0,1,138.0,41.7],[155,1,2001,16,0,2,0,0,1,61,191,3,40,336,1,0,116.7,34.4],[156,1,2005,14,0,0,0,0,0,106,349,3,21,181,0,0,92.0,25.9],[157,2,1999,16,0,0,0,0,0,5,38,0,81,1338,7,1,260.6,90.9],[32,2,1999,16,0,0,0,0,0,0,0,0,80,1129,5,0,222.9,77.7],[158,2,2004,14,0,1,0,0,0,1,1,0,54,817,8,1,181.8,63.4],[159,2,2002,14,0,0,0,0,0,0,0,0,36,595,5,0,127.5,44.5],[160,2,2003,13,1,1,21,0,0,3,51,0,49,449,4,1,123.8,43.2],[161,2,2000,14,0,0,0,0,0,0,0,0,40,434,3,0,101.4,35.4],[162,2,2005,12,0,0,0,0,0,1,7,0,40,417,0,0,82.4,28.7],[163,2,2003,5,0,0,0,0,0,2,17,0,22,243,3,0,66.0,23.0],[164,3,1999,16,0,0,0,0,0,0,0,0,47,591,4,0,130.1,73.8],[165,3,2005,16,0,0,0,0,0,0,0,0,46,516,3,1,113.6,64.4],[39,3,2003,13,0,0,0,0,0,0,0,0,37,434,2,0,92.4,52.4],[60,3,2004,15,0,0,0,0,0,0,0,0,41,377,1,0,84.7,48.0]],"ARI|0":[[166,0,2001,16,304,525,3653,18,14,35,163,0,0,0,0,3,202.4,74.4],[132,0,2005,10,242,375,2713,11,9,13,28,0,1,0,0,5,130.3,52.0],[167,0,2004,14,233,408,2511,11,10,36,112,2,1,-5,0,5,140.1,49.4],[168,0,2003,13,207,367,2247,13,15,30,177,2,0,0,0,3,137.6,46.8],[85,1,2000,16,0,0,0,0,0,184,719,4,73,579,2,3,232.8,71.4],[169,1,2002,15,0,0,0,0,0,188,834,6,38,413,3,4,208.7,67.1],[4,1,2004,15,1,1,21,1,0,267,937,9,15,105,0,1,176.0,51.0],[170,1,1999,16,0,0,0,0,0,193,553,0,49,335,0,2,133.8,34.0],[88,1,2001,16,0,0,0,0,0,112,380,5,21,151,0,1,102.1,29.3],[171,1,2005,15,0,0,0,0,0,112,370,2,25,139,0,1,85.9,23.9],[172,2,2005,16,0,0,0,0,0,8,41,0,103,1409,10,0,308.0,107.4],[173,2,2001,16,0,0,0,0,0,5,35,0,98,1598,8,1,307.3,107.2],[174,2,2005,14,0,1,0,0,0,12,45,0,102,1402,7,1,288.7,100.7],[175,2,1999,16,0,1,0,0,0,0,0,0,79,954,1,2,176.4,61.5],[176,2,1999,13,0,0,0,0,0,0,0,0,37,621,5,0,129.1,45.0],[177,2,2004,15,0,0,0,0,0,2,-6,0,49,537,1,0,108.1,37.7],[178,2,2001,13,0,0,0,0,0,3,4,0,32,518,3,3,96.2,33.6],[179,2,2002,9,0,0,0,0,0,0,0,0,25,362,1,0,67.2,23.4],[180,3,2003,15,0,0,0,0,0,0,0,0,55,517,3,0,124.7,70.7],[181,3,2005,14,0,0,0,0,0,0,0,0,28,270,1,0,61.0,34.6],[182,3,2001,14,0,0,0,0,0,0,0,0,25,196,2,0,56.6,32.1],[183,3,1999,15,0,0,0,0,0,0,0,0,30,222,0,0,52.2,29.6]],"PIT|0":[[184,0,2001,16,266,442,3109,14,11,96,537,5,0,0,0,3,236.1,88.3],[185,0,2004,14,196,295,2621,17,11,56,144,1,0,0,0,2,167.2,69.9],[186,0,2002,12,234,377,2836,20,16,19,43,0,0,0,0,3,165.7,64.0],[187,0,1999,9,139,258,1625,12,8,16,19,0,0,0,0,2,96.9,33.1],[188,1,2005,15,0,0,0,0,0,255,1202,4,18,218,1,0,190.0,63.3],[189,1,2000,16,0,2,0,0,1,355,1341,8,13,97,0,0,202.8,61.1],[190,1,1999,16,0,0,0,0,0,93,567,5,27,253,3,2,153.0,53.7],[191,1,2002,16,0,0,0,0,0,193,762,4,42,341,0,2,172.3,52.8],[192,1,2004,10,0,0,0,0,0,192,830,1,6,55,0,2,96.5,31.6],[193,1,2001,14,0,0,0,0,0,120,453,3,16,127,1,0,98.0,29.3],[194,2,2002,16,0,0,0,0,0,12,142,0,112,1329,12,1,335.1,116.9],[141,2,2002,16,0,0,0,0,0,0,0,0,78,1325,7,1,252.5,88.1],[195,2,1999,16,0,0,0,0,0,0,0,0,61,714,5,1,160.4,55.9],[196,2,2000,16,0,0,0,0,0,0,0,0,40,672,4,2,127.2,44.4],[197,2,2002,16,7,8,45,0,0,19,134,0,47,489,2,2,127.1,44.3],[198,2,2005,15,0,0,0,0,0,1,0,0,26,451,0,0,71.1,24.8],[199,2,1999,11,0,0,0,0,0,0,0,0,30,285,0,0,58.5,20.4],[107,2,2002,12,0,0,0,0,0,0,0,0,23,218,2,0,56.8,19.8],[200,3,2005,14,0,0,0,0,0,0,0,0,39,459,6,0,120.9,68.6],[201,3,2000,16,0,0,0,0,0,0,0,0,17,192,3,0,54.2,30.7],[202,3,2004,7,0,0,0,0,0,0,0,0,9,89,3,0,35.9,20.4]],"CAR|0":[[203,0,1999,16,344,571,4436,36,15,27,124,2,0,0,0,8,299.8,115.8],[204,0,2004,16,310,533,3886,29,15,25,71,1,0,0,0,5,248.5,93.8],[205,0,2001,15,293,540,2931,11,19,37,128,6,0,0,0,2,168.0,55.1],[206,0,2002,14,223,381,2630,15,14,22,14,0,0,0,0,7,124.6,45.1],[45,1,2003,14,0,0,0,0,0,318,1444,8,14,159,0,3,216.3,70.3],[207,1,2004,16,0,0,0,0,0,217,821,6,45,394,1,1,206.5,62.3],[208,1,2005,15,0,1,0,0,0,205,879,2,34,372,1,1,175.1,55.9],[209,1,1999,11,0,0,0,0,0,138,718,6,23,189,0,1,147.7,51.0],[210,1,2002,11,0,0,0,0,0,209,737,7,20,167,0,2,148.4,42.6],[190,1,2001,13,0,1,0,0,0,165,665,2,21,101,1,2,111.6,34.5],[211,2,2005,16,0,0,0,0,0,4,25,1,103,1563,12,1,337.8,117.8],[212,2,2004,16,0,0,0,0,0,3,15,0,93,1405,16,1,329.0,114.7],[213,2,1999,14,0,0,0,0,0,2,16,0,63,1082,12,0,244.8,85.4],[214,2,2000,15,0,0,0,0,0,0,0,0,66,926,3,1,174.6,60.9],[215,2,2004,15,0,0,0,0,0,0,0,0,47,754,5,1,152.4,53.2],[216,2,2005,13,0,0,0,0,0,1,-8,0,25,441,4,0,92.3,32.2],[217,2,2001,15,0,0,0,0,0,1,-2,0,37,492,1,0,92.0,32.1],[218,3,1999,16,0,0,0,0,0,0,0,0,63,822,12,1,215.2,122.1],[219,3,2004,14,0,0,0,0,0,0,0,0,34,323,3,0,84.3,47.8],[220,3,2005,7,0,0,0,0,0,0,0,0,12,155,2,0,39.5,22.4],[221,3,2004,13,0,0,0,0,0,0,0,0,13,123,2,0,39.3,22.3]],"CIN|0":[[222,0,2005,16,345,509,3836,32,12,34,41,1,0,0,0,2,265.5,107.8],[223,0,2003,16,324,520,3591,26,15,38,113,0,0,0,0,4,220.9,85.2],[168,0,1999,14,215,389,2670,16,12,63,332,2,0,0,0,5,186.0,66.7],[224,1,2005,16,0,0,0,0,0,337,1458,12,23,90,0,0,249.8,79.3],[64,1,2001,16,0,1,0,0,1,340,1315,10,34,228,3,3,258.3,79.0],[225,1,2005,14,0,0,0,0,0,61,279,0,51,328,2,1,121.7,38.8],[226,1,2000,15,0,0,0,0,0,90,324,3,19,168,0,1,84.2,24.8],[227,1,1999,13,0,0,0,0,0,62,308,0,16,172,0,0,64.0,21.7],[48,1,2004,16,0,0,0,0,0,26,161,0,25,171,1,1,62.2,21.1],[228,2,2005,16,0,0,0,0,0,5,33,0,97,1432,9,0,297.5,103.8],[229,2,2005,14,0,0,0,0,0,8,62,1,78,956,7,1,225.8,78.8],[230,2,2003,15,0,0,0,0,0,18,157,0,79,819,7,1,222.6,77.6],[231,2,1999,16,0,0,0,0,0,0,0,0,68,1022,7,0,212.2,74.0],[232,2,1999,16,1,1,6,0,0,0,0,0,57,737,6,1,164.9,57.5],[233,2,2005,11,0,0,0,0,0,0,0,0,31,422,6,1,107.2,37.4],[234,2,2002,16,0,0,0,0,0,0,0,0,47,421,0,0,89.1,31.1],[235,2,2004,13,0,0,0,0,0,1,-1,0,31,378,3,0,86.7,30.2],[21,3,1999,16,0,0,0,0,0,0,0,0,26,344,2,0,72.4,41.1],[236,3,2003,11,0,0,0,0,0,0,0,0,24,332,2,0,69.2,39.3],[237,3,2003,12,0,0,0,0,0,0,0,0,21,212,0,0,42.2,23.9]],"GB|0":[[238,0,2001,16,314,510,3921,32,15,38,56,1,0,0,0,6,256.4,100.0],[239,1,2003,16,0,0,0,0,0,355,1883,15,50,367,5,5,385.0,127.7],[138,1,1999,14,0,0,0,0,0,279,1034,9,71,573,1,5,281.7,85.2],[240,1,2005,8,0,1,0,0,0,143,582,6,10,77,1,1,115.9,36.0],[241,1,2005,13,1,1,14,0,0,60,173,1,48,347,1,0,112.6,32.6],[242,1,2004,16,0,0,0,0,0,0,0,0,34,239,3,0,75.9,23.6],[243,1,2003,15,0,0,0,0,0,77,420,2,6,38,0,1,61.8,22.7],[244,2,2004,16,0,0,0,0,0,0,0,0,89,1382,12,2,295.2,103.0],[245,2,2004,16,0,0,0,0,0,3,4,0,84,1208,9,2,257.2,89.7],[246,2,1999,16,0,0,0,0,0,1,-2,0,74,1074,6,0,217.2,75.8],[159,2,1999,16,0,0,0,0,0,0,0,0,74,1051,5,1,207.1,72.2],[11,2,2002,15,0,0,0,0,0,0,0,0,56,817,2,1,147.7,51.5],[247,2,2005,16,0,0,0,0,0,8,34,0,49,549,4,0,137.3,47.9],[248,2,1999,16,0,0,0,0,0,0,0,0,37,637,5,0,132.7,46.3],[249,2,2003,15,0,0,0,0,0,1,-8,0,38,520,4,0,113.2,39.5],[250,3,2002,16,1,1,31,1,0,0,0,0,54,442,7,0,145.4,82.5],[251,3,2005,14,0,0,0,0,0,0,0,0,33,294,2,0,74.4,42.2],[252,3,2005,10,0,0,0,0,0,0,0,0,27,224,3,0,69.4,39.4],[253,3,1999,15,0,0,0,0,0,0,0,0,20,204,2,0,52.4,29.7]],"JAX|0":[[42,0,2000,16,311,512,3640,20,14,48,236,2,0,0,0,4,227.2,85.9],[254,0,2004,14,267,441,2941,15,10,39,148,2,1,-7,0,3,186.7,70.3],[255,0,2005,7,98,168,1117,4,1,31,172,3,0,0,0,1,93.9,35.2],[256,1,2000,13,0,0,0,0,0,292,1399,12,36,240,2,2,279.9,91.7],[151,1,1999,14,0,0,0,0,0,249,931,13,21,108,0,3,196.9,59.0],[257,1,2001,16,0,0,0,0,0,213,877,9,23,165,1,1,185.2,57.9],[258,1,2005,14,0,0,0,0,0,151,575,4,10,65,0,0,98.0,29.2],[259,1,2001,14,0,0,0,0,0,68,294,0,18,183,2,1,81.7,26.0],[260,1,2005,16,0,0,0,0,0,39,149,1,32,240,0,2,72.9,22.3],[261,2,1999,16,0,0,0,0,0,0,0,0,116,1636,6,1,315.6,110.1],[89,2,2000,16,0,0,0,0,0,0,0,0,94,1207,5,3,238.7,83.2],[262,2,2005,16,0,0,0,0,0,0,0,0,41,681,7,0,151.1,52.7],[263,2,2005,15,2,3,12,0,0,12,51,0,36,432,5,0,114.8,40.0],[195,2,2004,15,0,0,0,0,0,2,2,0,50,533,1,2,105.5,36.8],[196,2,2002,16,0,0,0,0,0,0,0,0,44,525,1,0,102.5,35.7],[264,2,2005,12,0,0,0,0,0,2,3,0,35,445,0,1,77.8,27.1],[265,2,2003,6,0,0,0,0,0,0,0,0,17,253,1,0,48.3,16.8],[266,3,2000,16,0,0,0,0,0,0,0,0,64,729,3,0,156.9,89.0],[267,3,1999,14,0,0,0,0,0,0,0,0,19,221,4,0,65.1,36.9],[145,3,2002,16,0,0,0,0,0,0,0,0,25,246,2,0,61.6,34.9],[268,3,2003,11,0,0,0,0,0,0,0,0,13,150,2,0,40.0,22.7]],"LV|0":[[269,0,2002,16,418,618,4689,26,10,50,156,3,0,0,0,3,303.2,120.6],[130,0,2005,15,301,565,3759,20,12,17,39,1,0,0,0,4,208.3,74.1],[270,1,2002,16,0,0,0,0,0,182,962,7,91,941,4,0,347.3,115.2],[121,1,2005,14,0,0,0,0,0,272,1025,9,70,563,2,1,294.8,89.6],[271,1,2000,14,0,0,0,0,0,232,1046,9,20,156,1,3,194.2,63.2],[272,1,1999,16,0,0,0,0,0,138,714,2,18,181,1,1,123.5,43.4],[191,1,2004,15,0,0,0,0,0,112,425,3,39,284,0,1,125.9,38.1],[273,1,2000,15,0,0,0,0,0,46,213,3,27,299,1,0,108.2,34.5],[274,2,2001,16,0,0,0,0,0,4,39,0,91,1165,9,1,269.4,94.0],[275,2,2002,16,0,0,0,0,0,3,20,0,92,1211,7,1,255.1,89.0],[276,2,2004,16,0,0,0,0,0,1,-4,0,64,998,9,2,213.4,74.4],[277,2,2005,15,0,0,0,0,0,0,0,0,60,1005,8,0,208.5,72.7],[278,2,2004,12,0,1,0,0,0,1,-3,0,50,679,6,0,153.6,53.6],[279,2,2000,16,0,0,0,0,0,0,0,0,41,606,6,0,137.6,48.0],[280,2,2005,13,0,0,0,0,0,1,5,0,37,554,3,0,110.9,38.7],[281,2,1999,16,0,0,0,0,0,0,0,0,39,552,2,0,108.2,37.7],[98,3,1999,16,0,0,0,0,0,0,0,0,39,555,9,0,148.5,84.2],[128,3,2002,14,0,0,0,0,0,0,0,0,32,409,2,0,84.9,48.2],[282,3,2001,16,0,0,0,0,0,0,0,0,33,298,3,0,80.8,45.8],[283,3,2005,12,0,0,0,0,0,0,0,0,24,303,3,0,72.3,41.0]],"CHI|0":[[284,0,2000,10,154,280,1646,8,9,50,326,3,0,0,0,3,124.4,41.5],[285,0,2001,14,228,395,2299,13,10,29,-19,0,0,0,0,3,116.1,40.9],[286,0,1999,8,167,275,1645,10,6,14,31,0,0,0,0,3,90.9,34.3],[184,0,2003,9,126,251,1418,7,12,59,290,3,0,0,0,3,103.7,29.9],[88,1,2004,14,0,0,0,0,0,240,948,7,56,427,0,1,233.5,71.8],[287,1,2001,14,0,0,0,0,0,278,1183,7,22,178,0,0,202.1,64.0],[288,1,2000,16,0,0,0,0,0,290,1120,2,39,291,1,4,190.1,57.7],[289,1,1999,15,0,0,0,0,0,287,916,3,45,340,2,4,192.6,54.1],[290,1,2005,13,0,0,0,0,0,76,391,2,7,48,0,0,62.9,22.2],[291,1,2002,16,1,1,27,0,0,103,329,1,16,125,0,2,64.5,17.1],[292,2,1999,16,0,0,0,0,0,0,0,0,84,1400,9,0,278.0,97.0],[293,2,2001,16,1,2,34,1,0,4,8,0,100,1071,8,1,259.3,90.4],[294,2,1999,16,0,0,0,0,0,2,11,0,88,947,4,0,207.8,72.5],[212,2,2005,15,0,0,0,0,0,0,0,0,64,750,4,0,163.0,56.8],[295,2,2002,16,0,0,0,0,0,3,11,0,51,656,4,1,139.7,48.7],[31,2,2000,16,0,0,0,0,0,3,72,0,55,549,2,0,129.1,45.0],[296,2,2004,16,0,0,0,0,0,3,10,0,42,699,1,1,116.9,40.8],[126,2,1999,9,0,0,0,0,0,1,-2,0,44,426,4,1,108.4,37.8],[297,3,2003,15,0,0,0,0,0,0,0,0,44,433,2,2,95.3,54.1],[298,3,1999,16,0,0,0,0,0,0,0,0,38,277,1,0,71.7,40.7],[299,3,2002,10,0,0,0,0,0,0,0,0,20,193,3,0,57.3,32.5],[300,3,2001,13,0,0,0,0,0,0,0,0,22,148,2,0,48.8,27.7]],"PHI|0":[[301,0,2004,15,299,469,3875,31,8,41,220,3,0,0,0,6,291.0,116.7],[150,0,2005,9,94,207,1158,5,8,34,118,3,0,0,0,2,76.1,19.6],[302,1,2004,13,0,0,0,0,0,177,812,3,73,703,6,1,276.5,88.9],[192,1,2002,16,0,0,0,0,0,269,1029,5,51,541,3,0,258.0,78.6],[303,1,2003,15,0,0,0,0,0,126,542,8,10,133,1,2,127.5,40.6],[304,1,2000,11,0,0,0,0,0,112,334,3,24,275,1,1,106.9,29.2],[138,1,2002,16,0,2,0,0,0,75,411,1,19,124,1,1,82.5,29.1],[49,1,2000,16,1,4,21,0,0,25,187,2,13,89,1,1,69.4,24.4],[305,2,2004,14,0,0,0,0,0,3,-5,0,77,1200,14,1,278.5,97.1],[57,2,2001,15,0,0,0,0,0,6,57,0,63,833,8,1,198.0,69.1],[306,2,2002,15,0,0,0,0,0,1,-15,0,60,798,7,0,180.3,62.9],[307,2,2000,16,0,0,0,0,0,5,18,0,56,642,7,0,164.0,57.2],[308,2,1999,15,0,2,0,0,0,0,0,0,49,655,4,0,138.5,48.3],[246,2,2002,15,0,0,0,0,0,0,0,0,46,600,4,0,130.0,45.3],[309,2,2005,14,0,0,0,0,0,1,5,0,43,571,4,0,124.6,43.5],[310,2,2005,16,0,0,0,0,0,2,13,0,48,561,1,0,111.4,38.9],[311,3,2000,16,0,0,0,0,0,0,0,0,69,735,3,0,160.5,91.0],[312,3,2005,16,0,0,0,0,0,0,0,0,61,682,3,1,145.2,82.4],[313,3,1999,16,0,0,0,0,0,0,0,0,26,295,4,0,79.5,45.1],[314,3,2000,12,0,0,0,0,0,0,0,0,10,46,5,0,44.6,25.3]],"SEA|0":[[315,0,2003,16,313,513,3841,26,15,36,125,2,0,0,0,1,250.1,95.9],[223,0,1999,15,270,495,3346,23,16,35,56,0,0,0,0,5,189.4,67.7],[316,1,2005,16,0,0,0,0,0,370,1880,27,15,78,1,1,376.8,123.7],[317,1,2000,16,0,0,0,0,0,278,1242,7,63,613,2,2,298.5,95.4],[318,1,2003,16,0,0,0,0,0,37,174,1,29,216,0,1,72.0,23.1],[319,1,1999,16,0,0,0,0,0,14,38,0,34,228,1,0,66.6,20.1],[320,2,2004,16,0,0,0,0,0,0,0,0,87,1199,7,1,248.9,86.8],[321,2,2002,16,0,0,0,0,0,8,56,0,78,1240,5,0,237.6,82.9],[322,2,1999,16,0,0,0,0,0,0,0,0,62,829,10,0,204.9,71.5],[323,2,1999,16,0,0,0,0,0,0,0,0,58,992,7,1,197.2,68.8],[92,2,2005,15,0,0,0,0,0,0,0,0,55,694,10,0,184.4,64.3],[294,2,2005,13,0,0,0,0,0,0,0,0,67,778,3,2,158.8,55.4],[324,2,2005,10,0,0,0,0,0,0,0,0,28,400,2,0,80.0,27.9],[275,2,2004,9,0,0,0,0,0,0,0,0,25,362,3,0,79.2,27.6],[325,3,2005,15,0,0,0,0,0,0,0,0,45,554,5,0,130.4,74.0],[326,3,2003,16,0,0,0,0,0,0,0,0,46,492,4,0,119.2,67.6],[78,3,1999,16,0,0,0,0,0,0,0,0,35,376,0,0,72.6,41.2]],"MIN|0":[[327,0,2004,16,378,548,4717,39,11,88,406,2,0,0,0,5,371.3,130],[328,0,1999,12,192,329,2816,23,12,16,41,0,0,0,0,5,174.7,68.6],[41,0,2005,15,184,294,1885,12,4,18,53,0,0,0,0,3,114.7,46.3],[329,0,1999,6,125,200,1475,8,9,10,58,0,0,0,0,2,74.8,28.4],[330,1,2000,16,0,0,0,0,0,295,1521,7,36,348,3,1,280.9,94.4],[331,1,2003,16,0,0,0,0,0,174,745,5,65,644,3,1,249.9,78.9],[332,1,2002,16,0,0,0,0,0,255,1296,5,37,351,1,3,231.7,78.6],[333,1,2005,16,0,0,0,0,0,155,662,1,37,339,2,1,159.1,50.5],[334,1,2004,11,0,0,0,0,0,124,544,2,36,394,2,1,153.8,49.1],[335,1,1999,15,0,0,0,0,0,138,555,10,17,166,0,3,143.1,44.3],[277,2,2003,16,0,1,0,0,0,6,18,0,111,1632,17,1,376.0,130],[336,2,1999,15,0,0,0,0,0,0,0,0,90,1241,13,0,292.1,101.9],[337,2,2004,16,0,0,0,0,0,6,49,0,68,1006,9,0,235.5,82.1],[292,2,2004,15,0,0,0,0,0,0,0,0,47,657,8,0,160.7,56.0],[338,2,2002,14,0,0,0,0,0,0,0,0,50,689,4,1,140.9,49.1],[339,2,2005,16,0,0,0,0,0,2,3,0,50,604,4,0,134.7,47.0],[340,2,1999,15,0,0,0,0,0,0,0,0,44,643,2,0,120.3,42.0],[341,2,2003,14,0,0,0,0,0,10,71,0,25,522,4,1,106.3,37.1],[342,3,2004,14,0,0,0,0,0,0,0,0,71,705,4,0,165.5,93.9],[343,3,2001,16,0,0,0,0,0,0,0,0,57,666,3,1,139.6,79.2],[344,3,2003,15,0,0,0,0,0,2,15,0,46,401,4,0,111.6,63.3],[345,3,1999,15,0,0,0,0,0,0,0,0,28,327,1,0,66.7,37.8]],"DEN|0":[[166,0,2004,16,302,521,4089,27,20,62,202,1,0,0,0,1,255.8,95.6],[82,0,2000,10,216,336,2688,19,4,29,102,1,0,0,0,3,187.7,78.2],[149,0,2000,9,138,232,1776,9,8,22,64,1,0,0,0,3,97.4,36.6],[46,1,2002,16,0,0,0,0,0,273,1508,15,33,364,2,3,316.2,107.8],[346,1,2000,16,0,0,0,0,0,297,1487,15,23,169,0,4,272.6,90.9],[347,1,2004,16,0,0,0,0,0,275,1240,6,32,241,2,3,222.1,71.9],[348,1,1999,12,0,0,0,0,0,276,1159,7,21,159,0,2,192.8,60.8],[349,1,2005,14,0,0,0,0,0,173,921,8,18,104,0,1,166.5,58.9],[350,1,2001,8,0,0,0,0,0,167,701,0,12,69,0,0,89.0,28.4],[351,2,2000,16,0,0,0,0,0,6,99,1,100,1602,8,1,322.1,112.3],[352,2,2000,16,0,0,0,0,0,0,0,0,101,1317,9,0,288.7,100.7],[353,2,2004,16,0,0,0,0,0,3,5,0,54,1084,7,0,204.9,71.5],[354,2,2004,16,0,0,0,0,0,5,33,0,31,385,1,0,78.8,27.5],[355,3,2003,15,0,0,0,0,0,0,0,0,62,770,8,0,187.0,106.1],[297,3,2001,16,0,0,0,0,0,0,0,0,51,566,6,0,143.6,81.4],[356,3,2004,14,0,0,0,0,0,0,0,0,36,572,2,0,105.2,59.7],[343,3,1999,14,0,0,0,0,0,0,0,0,32,488,2,0,92.8,52.6]],"CLE|0":[[357,0,2002,14,273,443,2842,18,18,23,77,0,0,0,0,2,155.4,57.5],[358,0,2004,11,144,252,1731,10,9,35,169,2,0,0,0,7,106.1,37.8],[359,0,2005,11,199,333,2321,11,12,20,46,0,0,0,0,7,103.4,37.6],[360,0,2003,10,193,302,1797,10,12,8,7,0,0,0,0,2,84.6,31.5],[347,1,2005,16,0,0,0,0,0,309,1232,2,39,369,0,1,209.1,64.4],[361,1,1999,16,1,1,2,0,0,130,452,6,58,528,3,1,208.1,62.1],[362,1,2002,14,0,0,0,0,0,106,470,3,63,452,0,0,173.2,55.1],[363,1,2002,16,0,0,0,0,0,243,887,6,16,113,0,2,148.0,43.3],[364,1,2000,15,0,0,0,0,0,173,512,7,37,191,1,1,153.3,41.4],[365,1,2004,10,0,0,0,0,0,199,744,2,20,178,1,3,124.2,36.5],[265,2,2001,16,0,0,0,0,0,0,0,0,84,1097,9,0,247.7,86.4],[366,2,2002,16,0,0,0,0,0,3,7,0,56,964,7,2,193.1,67.3],[15,2,2005,16,0,0,0,0,0,1,3,0,69,1009,4,1,192.2,67.0],[367,2,2002,13,0,0,0,0,0,8,104,1,38,601,5,1,156.5,54.6],[368,2,2003,16,0,0,0,0,0,5,28,0,40,576,5,0,130.4,45.5],[369,2,1999,14,0,0,0,0,0,0,0,0,44,487,4,0,116.7,40.7],[370,2,2005,10,0,0,0,0,0,0,0,0,32,512,3,0,101.2,35.3],[72,2,2000,14,0,0,0,0,0,0,0,0,38,546,1,1,96.6,33.7],[371,3,2005,15,0,0,0,0,0,0,0,0,43,401,3,0,101.1,57.3],[372,3,2004,14,0,0,0,0,0,0,0,0,26,252,4,0,75.2,42.7],[373,3,2002,15,0,0,0,0,0,0,0,0,25,179,3,0,60.9,34.5],[374,3,1999,12,0,0,0,0,0,0,0,0,24,222,1,0,52.2,29.6]],"IND|0":[[375,0,2004,16,336,497,4557,49,10,25,38,0,0,0,0,1,360.1,130],[376,1,2000,16,0,0,0,0,0,387,1709,13,63,594,5,4,395.3,125.1],[377,1,2001,15,0,0,0,0,0,233,1104,9,34,224,0,6,214.8,71.1],[378,1,2002,9,0,0,0,0,0,97,336,8,13,81,0,2,98.7,28.8],[379,1,2003,13,0,0,0,0,0,48,155,2,22,157,1,2,67.2,19.6],[380,2,2002,16,0,0,0,0,0,2,10,0,143,1722,11,0,384.2,130],[381,2,2004,16,0,0,0,0,0,1,-4,0,77,1210,12,0,269.6,94.0],[382,2,2004,15,0,0,0,0,0,0,0,0,68,1077,10,1,233.7,81.5],[383,2,2000,16,0,0,0,0,0,1,3,0,50,646,3,0,132.9,46.4],[384,2,1999,16,0,0,0,0,0,1,2,0,42,565,4,1,132.7,46.3],[385,2,2002,14,0,0,0,0,0,0,0,0,44,462,3,0,108.2,37.7],[386,2,2003,13,0,0,0,0,0,1,6,0,36,456,3,0,100.2,34.9],[387,2,1999,11,0,0,0,0,0,0,0,0,21,287,0,0,49.7,17.3],[165,3,2001,16,0,0,0,0,0,0,0,0,47,739,8,0,168.9,95.8],[95,3,2000,16,0,0,0,0,0,0,0,0,47,538,3,1,116.8,66.2],[388,3,2005,14,0,0,0,0,0,0,0,0,37,488,4,0,109.8,62.3],[389,3,2005,10,0,0,0,0,0,0,0,0,18,202,3,0,56.2,31.9]],"MIA|0":[[390,0,2001,16,273,450,3290,20,19,73,321,4,0,0,0,4,221.7,82.8],[149,0,2005,16,257,494,2996,18,13,27,61,0,0,0,0,4,163.9,55.6],[391,0,1999,11,204,369,2448,12,17,6,-6,0,0,0,0,3,105.3,33.8],[392,0,1999,9,125,216,1288,8,4,28,124,0,1,0,0,2,84.9,31.0],[393,1,2002,16,0,0,0,0,0,383,1853,16,47,363,1,4,362.6,117.7],[210,1,2000,15,0,1,0,0,0,309,1139,14,31,201,2,3,255.0,76.7],[394,1,2005,15,0,0,0,0,0,207,907,4,32,232,1,4,167.9,54.2],[395,1,2004,13,0,0,0,0,0,132,523,6,22,124,0,0,122.7,37.7],[396,1,1999,14,0,0,0,0,0,47,158,1,43,312,4,0,120.0,36.2],[397,1,2001,16,0,0,0,0,0,59,281,2,29,263,1,0,101.4,32.9],[398,2,2005,16,0,0,0,0,0,12,92,0,82,1118,11,2,265.0,92.4],[110,2,1999,15,0,0,0,0,0,1,-6,0,67,1037,5,0,200.1,69.8],[399,2,2000,16,0,0,0,0,0,0,0,0,56,786,6,0,170.6,59.5],[14,2,2001,16,0,0,0,0,0,6,39,0,55,684,3,3,141.3,49.3],[293,2,2005,14,0,1,0,0,0,0,0,0,39,686,3,0,125.6,43.8],[400,2,2000,13,0,0,0,0,0,4,3,0,35,446,4,0,103.9,36.2],[401,2,1999,12,0,0,0,0,0,0,0,0,43,516,2,2,102.6,35.8],[56,2,2004,13,0,0,0,0,0,0,0,0,23,359,4,0,82.9,28.9],[402,3,2004,16,0,0,0,0,0,0,0,0,73,791,4,0,178.1,101.0],[403,3,1999,12,0,0,0,0,0,0,0,0,32,299,1,0,67.9,38.5],[404,3,2001,14,0,0,0,0,0,0,0,0,18,215,2,1,49.5,28.1]],"TEN|0":[[405,0,2001,15,264,431,3350,21,12,75,414,5,0,0,0,3,265.4,102.1],[406,0,2004,10,218,357,2486,18,10,11,50,1,1,0,0,2,159.4,61.8],[407,0,1999,8,116,195,1382,10,5,19,1,0,0,0,0,2,81.4,31.6],[408,1,2000,16,0,0,0,0,0,403,1509,14,50,453,2,4,334.2,101.7],[409,1,2004,11,0,0,0,0,0,220,1067,6,20,147,0,4,169.4,57.8],[65,1,2004,11,0,0,0,0,0,137,509,4,22,169,0,1,111.8,33.2],[410,1,2001,9,0,0,0,0,0,56,341,1,5,22,0,0,47.3,18.4],[411,1,2003,15,0,0,0,0,0,63,201,1,19,121,1,1,63.2,17.8],[412,1,2002,12,0,0,0,0,0,9,18,1,16,167,3,1,56.5,16.9],[413,2,2004,15,1,1,26,1,0,1,12,0,80,1247,11,0,276.9,96.6],[414,2,2003,16,0,0,0,0,0,3,11,0,95,1303,8,0,274.4,95.7],[415,2,2001,16,0,0,0,0,0,0,0,0,54,825,7,0,180.5,63.0],[124,2,2003,16,0,0,0,0,0,1,13,0,47,813,7,1,175.6,61.2],[416,2,1999,10,0,0,0,0,0,0,0,0,38,648,4,1,124.8,43.5],[417,2,2000,15,0,0,0,0,0,0,0,0,33,536,0,0,86.6,30.2],[418,2,2003,9,0,0,0,0,0,1,5,0,18,297,4,0,74.2,25.9],[419,2,2005,9,0,0,0,0,0,1,1,0,23,299,2,0,65.0,22.7],[420,3,2000,16,2,2,53,1,0,0,0,0,70,636,4,3,157.7,89.5],[421,3,2005,14,0,0,0,0,0,0,0,0,55,530,4,0,132.0,74.9],[422,3,2005,13,0,0,0,0,0,0,0,0,55,543,2,0,121.3,68.8],[423,3,2005,13,0,0,0,0,0,0,0,0,37,273,2,0,76.3,43.3]],"BUF|0":[[0,0,2002,16,375,610,4359,24,15,27,67,2,0,0,0,4,251.1,95.6],[424,0,1999,15,264,478,3171,19,16,88,476,1,0,0,0,4,216.4,77.2],[425,0,2000,12,179,306,2125,12,7,42,307,1,1,-6,0,2,152.1,57.0],[426,0,2001,12,178,307,2056,12,11,12,33,0,0,0,0,1,111.5,39.8],[427,1,2002,16,0,0,0,0,0,325,1438,13,43,309,1,9,283.7,90.5],[428,1,2004,15,0,0,0,0,0,284,1128,13,22,169,0,2,225.7,69.5],[47,1,2001,16,0,0,0,0,0,34,160,2,80,620,2,1,180.0,56.6],[429,1,1999,16,0,0,0,0,0,205,695,5,29,228,1,3,153.3,43.2],[395,1,2000,12,0,0,0,0,0,93,341,5,37,268,1,1,131.9,39.8],[153,1,2000,16,0,0,0,0,0,161,591,0,32,271,2,0,132.2,39.0],[430,2,2002,16,0,0,0,0,0,1,7,0,100,1292,10,0,289.9,101.1],[109,2,2002,16,0,0,0,0,0,3,-13,0,94,1252,9,1,269.9,94.1],[431,2,2004,15,0,0,0,0,0,5,85,0,48,843,9,1,192.8,67.2],[196,2,2003,16,0,0,0,0,0,0,0,0,56,732,4,0,153.2,53.4],[432,2,2003,16,0,0,0,0,0,3,38,0,58,588,2,1,130.6,45.5],[433,2,2000,16,0,0,0,0,0,0,0,0,43,697,2,0,124.7,43.5],[434,2,1999,16,0,0,0,0,0,0,0,0,52,536,1,0,111.6,38.9],[435,2,1999,16,0,0,0,0,0,1,13,0,31,381,0,0,70.4,24.6],[436,3,2001,16,0,0,0,0,0,0,0,0,53,590,3,0,130.0,73.7],[373,3,2003,13,0,0,0,0,0,0,0,0,34,339,1,0,73.9,41.9],[97,3,2002,10,0,0,0,0,0,0,0,0,16,141,2,0,42.1,23.9]],"SF|0":[[358,0,2000,16,355,561,4278,31,10,72,414,4,0,0,0,1,340.5,130],[437,0,2004,9,198,325,2169,10,10,12,55,0,0,0,0,6,106.3,39.4],[270,1,2000,16,0,0,0,0,0,258,1142,7,68,647,3,3,300.9,95.9],[438,1,2001,16,0,0,0,0,0,252,1206,4,41,347,1,1,224.3,74.4],[439,1,2003,16,0,0,0,0,0,201,1024,6,35,307,1,4,202.1,69.5],[440,1,2005,14,0,0,0,0,0,127,608,3,15,131,0,2,102.9,35.0],[441,1,1999,13,0,0,0,0,0,58,276,4,32,282,0,2,107.8,34.8],[442,1,2005,14,0,0,0,0,0,59,308,3,12,47,0,0,65.5,22.6],[305,2,2001,16,0,0,0,0,0,4,21,0,93,1412,16,0,332.3,115.9],[275,2,2000,16,0,1,0,0,0,1,-2,0,75,805,7,2,193.3,67.4],[443,2,2002,15,0,0,0,0,0,0,0,0,72,756,5,0,177.6,61.9],[444,2,2001,16,0,0,0,0,0,0,0,0,54,585,7,0,154.5,53.9],[445,2,2005,15,0,0,0,0,0,0,0,0,48,733,5,1,149.3,52.1],[198,2,2004,14,0,0,0,0,0,1,6,0,47,641,3,0,129.7,45.2],[126,2,2004,12,0,0,0,0,0,0,0,0,38,403,3,0,98.3,34.3],[446,2,2005,9,2,2,27,0,0,8,11,0,32,363,3,1,86.5,30.2],[447,3,2004,16,0,0,0,0,0,0,0,0,82,825,2,1,174.5,99.0],[404,3,2003,15,0,0,0,0,0,0,0,0,35,437,1,0,84.7,48.0],[448,3,2000,15,0,0,0,0,0,0,0,0,38,342,2,0,84.2,47.8]],"NO|0":[[449,0,2002,16,283,528,3572,27,15,62,253,2,0,0,0,5,256.2,92.8],[168,0,2000,11,184,302,2025,13,9,57,243,1,0,0,0,3,139.3,53.0],[450,0,1999,10,140,268,1916,7,16,26,142,3,0,0,0,2,106.8,31.8],[451,1,2003,16,0,2,0,0,0,351,1641,8,69,516,0,3,326.7,105.5],[393,1,2001,16,0,0,0,0,0,313,1245,6,60,511,1,6,265.6,81.9],[65,1,2005,16,0,0,0,0,0,166,659,3,12,46,0,2,96.5,29.5],[452,1,2005,15,0,0,0,0,0,95,363,0,35,281,0,3,93.4,28.3],[453,1,2000,16,0,0,0,0,0,36,136,0,30,213,0,1,62.9,19.2],[210,1,1999,13,0,1,0,0,0,60,205,0,20,151,1,0,61.6,17.9],[33,2,2004,16,0,0,0,0,0,0,0,0,94,1399,11,0,301.9,105.3],[454,2,2001,16,0,0,0,0,0,0,0,0,81,1046,5,0,217.6,75.9],[455,2,2005,16,0,0,0,0,0,2,2,0,70,945,7,1,204.7,71.4],[31,2,1999,16,0,0,0,0,0,3,20,0,61,835,4,1,170.5,59.5],[456,2,1999,15,0,0,0,0,0,1,14,0,42,796,6,0,159.0,55.5],[383,2,2003,16,0,0,0,0,0,0,0,0,44,578,4,1,123.8,43.2],[457,2,1999,15,0,0,0,0,0,1,4,0,40,564,1,0,102.8,35.9],[160,2,2005,11,0,0,0,0,0,0,0,0,34,489,2,0,94.9,33.1],[458,3,2003,14,0,0,0,0,0,0,0,0,41,436,5,0,114.6,65.0],[459,3,2005,12,0,0,0,0,0,0,0,0,35,396,1,0,80.6,45.7],[345,3,2000,15,0,0,0,0,0,0,0,0,21,281,4,0,73.1,41.5],[460,3,2003,9,0,0,0,0,0,0,0,0,26,290,2,0,67.0,38.0]],"BAL|0":[[461,0,2004,16,258,464,2559,13,11,53,189,1,0,0,0,7,145.3,49.7],[23,0,2001,14,265,467,3033,15,18,21,18,1,0,0,0,5,143.1,49.5],[43,0,1999,11,169,320,2136,17,8,24,93,0,0,0,0,6,134.7,47.8],[168,0,2002,11,165,295,2084,13,11,39,106,1,0,0,0,5,122.0,43.2],[462,1,2003,16,0,0,0,0,0,387,2066,14,26,205,0,6,325.1,109.3],[463,1,1999,14,0,0,0,0,0,236,852,5,24,169,2,0,168.1,49.2],[464,1,2004,16,0,0,0,0,0,160,714,2,30,184,0,1,129.8,42.4],[24,1,2000,16,0,0,0,0,0,137,588,2,32,221,0,1,122.9,39.2],[67,1,2001,11,0,0,0,0,0,168,658,3,17,68,0,1,105.6,32.0],[465,1,2001,12,0,0,0,0,0,151,551,5,6,45,0,1,93.6,27.0],[385,2,2001,16,0,0,0,0,0,0,0,0,74,1059,7,1,221.9,77.4],[414,2,2005,16,0,0,0,0,0,0,0,0,86,1073,3,1,209.3,73.0],[339,2,2002,16,0,0,0,0,0,11,105,0,61,869,6,0,194.4,67.8],[466,2,1999,15,0,0,0,0,0,0,0,0,37,538,4,0,114.8,40.0],[467,2,2005,13,0,1,0,0,0,8,33,1,44,471,2,0,112.4,39.2],[292,2,2003,15,0,0,0,0,0,0,0,0,31,451,6,0,112.1,39.1],[468,2,1999,10,0,0,0,0,0,1,12,0,29,526,3,1,98.8,34.5],[469,2,2004,12,0,0,0,0,0,0,0,0,24,293,4,0,79.3,27.7],[470,3,2005,16,0,0,0,0,0,0,0,0,75,855,7,1,200.5,113.7],[355,3,2000,16,0,0,0,0,0,0,0,0,67,810,5,0,178.0,101.0],[471,3,2003,15,0,0,0,0,0,0,0,0,19,159,3,0,52.9,30.0],[472,3,2004,12,0,0,0,0,0,0,0,0,25,219,1,0,52.9,30.0]],"LAC|0":[[473,0,2004,15,262,400,3159,27,7,53,85,2,1,38,0,2,241.7,99.2],[424,0,2001,16,294,521,3464,15,18,53,192,1,0,0,0,2,183.8,64.7],[474,0,1999,14,249,434,2761,10,14,34,126,0,0,0,0,3,131.0,45.1],[475,0,2000,11,162,322,1883,11,18,28,54,0,0,0,0,6,76.7,18.1],[476,1,2003,16,1,1,21,1,0,313,1645,13,100,725,4,0,443.8,130],[477,1,2000,16,0,0,0,0,0,116,384,3,48,355,1,2,141.9,41.2],[478,1,2004,15,0,0,0,0,0,65,392,3,2,17,0,0,60.9,23.1],[479,1,1999,16,0,0,0,0,0,92,287,1,16,209,2,1,81.6,22.5],[480,1,1999,15,0,0,0,0,0,0,0,0,37,201,1,0,63.1,19.6],[481,1,2005,15,0,0,0,0,0,57,335,3,0,0,0,0,51.5,19.4],[126,2,2001,16,0,0,0,0,0,7,116,1,71,1125,6,1,235.1,82.0],[89,2,2005,16,0,0,0,0,0,2,6,0,70,917,9,0,216.3,75.4],[173,2,2003,14,0,0,0,0,0,3,18,0,70,880,7,2,199.8,69.7],[482,2,2000,14,0,0,0,0,0,0,0,0,55,907,4,1,167.7,58.5],[483,2,2005,15,0,0,0,0,0,4,55,0,57,725,3,1,151.0,52.7],[75,2,2002,16,0,0,0,0,0,12,108,1,50,623,2,0,141.1,49.2],[484,2,2004,6,0,0,0,0,0,4,45,0,18,310,3,0,71.5,24.9],[485,2,2004,13,0,0,0,0,0,0,0,0,15,308,2,0,57.8,20.2],[486,3,2005,15,0,0,0,0,0,0,0,0,89,1101,10,0,259.1,130],[180,3,2000,16,0,0,0,0,0,0,0,0,71,766,5,2,173.6,98.5],[60,3,2002,14,0,0,0,0,0,0,0,0,45,510,1,0,102.0,57.9],[39,3,1999,16,0,1,0,0,0,2,11,0,40,429,0,0,86.0,48.8]],"LA|0":[[132,0,1999,16,325,499,4353,41,13,23,92,1,0,0,0,5,319.3,129.1],[487,0,2004,14,321,485,3964,21,14,19,89,3,0,0,0,4,235.5,93.9],[22,0,2000,8,145,240,2063,16,5,20,69,1,0,0,0,2,145.4,59.3],[488,1,2000,14,0,0,0,0,0,253,1359,18,81,830,8,0,459.9,130],[489,1,2005,15,0,0,0,0,0,254,1046,8,43,320,2,3,233.6,72.9],[490,1,2001,16,0,0,0,0,0,78,441,6,17,154,0,3,106.5,37.1],[491,1,2002,13,0,0,0,0,0,65,228,1,30,278,2,3,92.6,27.6],[411,1,1999,15,0,0,0,0,0,78,294,4,14,163,1,3,83.7,25.2],[492,1,2000,10,0,0,0,0,0,54,249,4,10,56,0,0,64.5,21.0],[493,2,2003,16,0,0,0,0,0,1,5,0,117,1696,12,0,359.1,125.2],[494,2,2000,16,0,0,0,0,0,1,11,0,87,1471,9,1,287.2,100.2],[495,2,2005,16,0,0,0,0,0,1,5,1,60,801,6,1,180.6,63.0],[160,2,1999,15,0,0,0,0,0,4,44,0,36,677,8,2,158.1,55.1],[216,2,2001,14,0,0,0,0,0,1,5,0,40,563,5,0,128.8,44.9],[496,2,2003,16,1,1,11,0,0,0,0,0,47,495,3,1,112.9,39.4],[497,2,2004,16,0,0,0,0,0,4,0,0,37,494,3,2,100.4,35.0],[195,2,2002,11,0,0,0,0,0,3,21,0,18,157,2,1,45.8,16.0],[460,3,2001,16,0,0,0,0,0,7,28,1,38,431,4,2,109.9,62.3],[282,3,1999,16,0,0,0,0,0,0,0,0,25,226,6,0,83.6,47.4],[498,3,2003,15,0,0,0,0,0,4,15,0,29,238,2,0,66.3,37.6]],"HOU|0":[[499,0,2004,16,285,466,3531,16,14,73,299,0,0,0,0,3,201.1,76.3],[500,1,2004,15,0,0,0,0,0,302,1188,13,68,588,1,3,323.6,99.7],[288,1,2002,16,1,2,5,1,0,155,519,0,47,302,0,1,133.3,37.8],[501,1,2005,13,0,0,0,0,0,90,325,4,22,179,0,0,96.4,28.6],[502,1,2005,9,0,0,0,0,0,46,184,2,10,87,0,0,49.1,15.2],[257,1,2003,8,0,1,0,0,1,93,253,4,9,55,0,2,57.8,13.9],[503,2,2004,16,0,0,0,0,0,4,12,0,79,1142,6,1,228.4,79.7],[248,2,2002,16,0,0,0,0,0,2,-11,0,45,697,6,0,149.6,52.2],[504,2,2004,16,0,3,0,0,0,4,30,0,41,632,2,0,119.2,41.6],[505,2,2004,13,0,0,0,0,0,0,0,0,29,415,1,0,76.5,26.7],[506,2,2002,13,0,0,0,0,0,0,0,0,21,286,0,0,49.6,17.3],[507,3,2002,14,0,0,0,0,0,0,0,0,51,613,3,0,130.3,73.9],[508,3,2005,12,0,0,0,0,0,0,0,0,24,168,0,0,40.8,23.1]],"DEN|1":[[509,0,2008,16,384,616,4526,25,18,57,200,2,0,0,0,2,277.0,100.7],[510,0,2009,16,336,541,3802,21,12,24,71,0,0,0,0,2,215.2,78.7],[511,0,2010,7,41,82,654,5,3,43,227,6,0,0,0,0,98.9,34.3],[166,0,2006,12,175,317,1994,11,13,36,112,1,0,0,0,2,111.0,33.8],[512,1,2010,13,0,0,0,0,0,182,779,5,37,372,3,2,196.1,66.3],[513,1,2006,14,0,0,0,0,0,157,677,8,20,158,0,0,151.5,51.4],[514,1,2007,15,0,0,0,0,0,140,729,1,35,231,0,1,135.0,49.7],[349,1,2006,13,0,0,0,0,0,233,1025,2,24,115,0,5,140.0,48.2],[303,1,2009,14,0,0,0,0,0,120,642,1,31,240,0,2,121.2,45.0],[515,1,2008,10,0,0,0,0,0,68,343,5,14,179,1,0,102.2,36.1],[445,2,2010,16,0,0,0,0,0,1,-18,0,77,1448,11,0,286.0,102.8],[516,2,2007,16,0,0,0,0,0,5,57,0,102,1325,7,1,280.2,100.7],[244,2,2006,16,0,0,0,0,0,9,123,1,69,1084,8,0,243.7,87.6],[517,2,2008,15,0,1,0,0,0,11,109,0,91,980,5,1,229.9,82.7],[504,2,2010,16,0,0,0,0,0,0,0,0,65,875,2,0,164.5,59.1],[382,2,2007,13,0,0,0,0,0,1,-6,0,40,635,5,0,132.9,47.8],[351,2,2006,16,0,0,0,0,0,1,-5,0,52,512,3,1,118.7,42.7],[518,2,2010,10,0,0,0,0,0,2,1,0,22,283,2,2,58.4,21.0],[519,3,2007,13,0,0,0,0,0,0,0,0,49,549,5,1,131.9,62.9],[77,3,2008,14,0,0,0,0,0,0,0,0,32,389,4,0,94.9,45.3],[60,3,2006,10,0,0,0,0,0,0,0,0,18,160,2,0,46.0,21.9]],"TB|1":[[520,0,2010,16,291,474,3451,25,6,68,364,0,0,0,0,3,258.4,96.4],[358,0,2008,12,243,376,2712,12,6,35,148,1,0,0,0,2,163.3,61.8],[521,0,2006,13,177,328,1661,9,9,41,161,0,0,0,0,6,88.5,24.5],[522,1,2007,15,0,0,0,0,0,222,898,10,49,324,0,1,229.2,76.0],[84,1,2008,15,0,0,0,0,0,186,786,2,47,330,0,0,170.6,57.4],[87,1,2009,16,0,0,0,0,0,211,823,4,28,217,3,0,174.0,56.5],[523,1,2010,13,0,0,0,0,0,201,1007,6,5,14,0,3,137.1,51.0],[85,1,2006,16,0,0,0,0,0,50,245,1,47,405,0,1,116.0,40.1],[524,1,2009,14,0,0,0,0,0,114,409,1,20,150,2,0,93.9,29.3],[15,2,2008,15,0,0,0,0,0,2,22,0,83,1248,7,1,250.0,89.9],[525,2,2010,16,0,0,0,0,0,0,0,0,65,964,11,2,223.4,80.3],[13,2,2006,14,0,0,0,0,0,2,9,0,62,1057,7,0,210.6,75.7],[94,2,2007,15,0,0,0,0,0,1,6,0,62,722,1,2,136.8,49.2],[90,2,2008,14,0,0,0,0,0,2,5,0,38,484,1,1,90.9,32.7],[526,2,2010,14,0,0,0,0,0,6,35,0,25,395,2,0,80.0,28.8],[527,2,2009,13,0,0,0,0,0,0,0,0,31,334,1,0,76.4,27.5],[528,2,2009,13,0,0,0,0,0,0,0,0,24,366,1,0,66.6,23.9],[529,3,2009,16,0,0,0,0,0,1,7,0,77,884,5,0,196.1,93.5],[96,3,2007,13,0,0,0,0,0,0,0,0,32,385,3,0,88.5,42.2],[325,3,2008,15,0,0,0,0,0,0,0,0,36,397,2,0,87.7,41.8],[530,3,2008,16,0,0,0,0,0,0,0,0,15,147,1,0,35.7,17.0]],"NYG|1":[[131,0,2009,16,317,509,4021,27,14,17,65,0,0,0,0,8,231.3,86.2],[134,1,2006,16,0,0,0,0,0,327,1662,5,58,465,0,1,298.7,105.9],[531,1,2010,16,0,0,0,0,0,276,1235,8,47,314,0,6,239.9,82.3],[137,1,2008,13,0,0,0,0,0,219,1089,15,6,36,0,1,206.5,74.2],[524,1,2008,16,0,0,0,0,0,182,1025,2,41,384,0,0,193.9,73.2],[347,1,2007,16,0,0,0,0,0,85,275,6,7,49,0,0,75.4,22.8],[532,2,2009,16,0,0,0,0,0,0,0,0,107,1220,7,0,271.0,97.4],[533,2,2010,13,0,0,0,0,0,0,0,0,79,1052,11,0,250.2,90.0],[141,2,2007,16,0,0,0,0,0,0,0,0,70,1025,12,0,244.5,87.9],[534,2,2010,16,0,0,0,0,0,1,2,0,60,944,9,1,206.6,74.3],[140,2,2007,15,0,0,0,0,0,0,0,0,59,760,3,0,153.0,55.0],[535,2,2008,16,0,0,0,0,0,2,26,0,43,596,2,0,119.2,42.9],[143,2,2006,12,0,0,0,0,0,0,0,0,22,253,2,1,57.3,20.6],[536,2,2010,7,0,0,0,0,0,0,0,0,24,223,1,0,52.3,18.8],[144,3,2006,15,0,0,0,0,0,0,0,0,66,623,7,0,170.3,81.2],[537,3,2009,15,0,0,0,0,0,1,16,0,42,567,5,0,130.3,62.1],[538,3,2010,15,0,0,0,0,0,0,0,0,13,116,2,0,36.6,17.5]],"DAL|1":[[539,0,2007,16,335,520,4211,36,19,31,129,2,0,0,0,2,295.3,111.1],[223,0,2010,10,209,318,2365,16,12,31,147,1,0,0,0,1,157.3,59.8],[0,0,2006,6,90,169,1164,7,8,8,28,2,0,0,0,1,71.4,21.9],[8,1,2007,16,0,0,0,0,0,204,975,10,44,282,2,0,241.7,84.8],[540,1,2010,16,0,0,0,0,0,185,800,1,48,450,1,1,183.0,62.2],[6,1,2006,16,0,0,0,0,0,267,1084,4,9,142,0,1,153.6,50.7],[541,1,2008,12,0,0,0,0,0,92,472,2,21,185,0,0,98.7,35.8],[305,2,2007,15,0,0,0,0,0,1,5,0,81,1355,15,0,307.0,110.4],[542,2,2009,16,0,0,0,0,0,2,-2,0,81,1320,11,0,278.8,100.2],[11,2,2006,15,0,0,0,0,0,3,11,0,70,1047,6,0,211.8,76.1],[543,2,2007,15,0,0,0,0,0,0,0,0,50,697,7,1,159.7,57.4],[544,2,2010,12,0,0,0,0,0,1,0,0,45,561,6,1,147.1,52.9],[158,2,2009,15,0,0,0,0,0,0,0,0,38,596,7,1,137.6,49.5],[545,2,2007,15,0,0,0,0,0,0,0,0,19,314,1,0,56.4,20.3],[18,3,2007,16,0,0,0,0,0,0,0,0,96,1145,7,1,250.5,119.4],[546,3,2008,12,0,0,0,0,0,0,0,0,20,283,4,0,72.3,34.5]],"MIA|1":[[116,0,2008,16,321,476,3653,19,7,30,62,1,0,0,0,1,218.3,84.6],[547,0,2010,15,301,490,3301,15,19,35,52,0,0,0,0,2,155.2,53.8],[147,0,2006,11,223,388,2236,12,15,19,24,0,0,0,0,1,111.8,34.8],[548,0,2007,9,173,309,1773,6,6,31,102,4,0,0,0,3,111.1,34.8],[393,1,2009,16,0,1,0,0,1,241,1121,11,35,264,2,2,247.5,86.0],[394,1,2008,16,2,3,41,1,0,214,916,10,33,254,0,1,213.6,72.3],[478,1,2007,14,0,0,0,0,0,128,515,1,27,161,0,2,96.6,31.7],[395,1,2006,12,0,0,0,0,0,92,400,1,21,162,0,2,79.2,27.0],[549,1,2008,13,0,0,0,0,0,12,88,1,19,275,2,0,73.3,25.8],[550,1,2007,5,0,0,0,0,0,28,125,0,28,237,0,0,64.2,21.8],[516,2,2010,14,0,1,0,0,0,2,3,0,86,1014,3,1,203.7,73.2],[551,2,2010,16,0,0,0,0,0,2,-3,0,79,820,5,1,188.7,67.8],[293,2,2006,14,0,0,0,0,0,3,19,0,55,747,6,0,171.6,61.7],[552,2,2008,16,0,0,0,0,0,5,73,2,56,790,2,0,166.3,59.8],[398,2,2006,16,0,0,0,0,0,8,95,0,59,677,4,0,160.2,57.6],[553,2,2006,16,0,0,0,0,0,0,0,0,67,687,1,1,139.7,50.2],[554,2,2008,11,0,0,0,0,0,2,1,0,55,613,2,0,128.4,46.2],[555,2,2010,12,0,0,0,0,0,2,27,0,43,615,1,1,111.2,40.0],[402,3,2006,16,0,0,0,0,0,0,0,0,62,640,3,0,144.0,68.7],[556,3,2008,13,0,0,0,0,0,0,0,0,34,454,7,0,121.4,57.9],[252,3,2008,16,0,0,0,0,0,0,0,0,31,450,3,1,92.0,43.9],[557,3,2007,14,0,0,0,0,0,0,0,0,29,228,2,0,63.8,30.4]],"NE|1":[[63,0,2007,16,398,578,4806,50,8,37,98,2,0,0,0,4,390.0,130],[558,0,2008,16,327,516,3693,21,11,73,270,2,0,0,0,4,244.7,90.4],[66,1,2008,15,1,1,-2,0,0,83,507,3,58,486,3,0,193.2,69.9],[559,1,2010,16,0,0,0,0,0,229,1008,13,12,85,0,0,199.3,68.2],[64,1,2006,16,0,0,0,0,0,199,812,13,15,147,0,2,184.9,61.3],[560,1,2010,14,0,0,0,0,0,97,547,5,34,379,1,1,160.6,58.3],[561,1,2006,14,0,0,0,0,0,175,745,6,22,194,1,1,155.9,52.6],[395,1,2008,13,0,0,0,0,0,156,727,7,17,161,0,1,145.8,51.2],[277,2,2007,16,0,0,0,0,0,0,0,0,98,1493,23,0,385.3,130],[553,2,2009,14,0,0,0,0,0,5,36,0,123,1348,4,0,285.4,102.6],[484,2,2006,16,0,0,0,0,0,1,5,0,61,760,4,1,161.5,58.1],[71,2,2010,11,0,0,0,0,0,0,0,0,48,706,5,0,148.6,53.4],[455,2,2007,15,0,0,0,0,0,1,12,0,46,697,3,0,134.9,48.5],[504,2,2007,13,0,0,0,0,0,0,0,0,36,449,5,0,110.9,39.9],[70,2,2006,16,0,0,0,0,0,2,18,0,43,384,4,0,109.2,39.3],[562,2,2010,16,0,0,0,0,0,5,62,0,24,432,3,1,101.4,36.5],[563,3,2010,16,0,0,0,0,0,0,0,0,42,546,10,1,154.6,73.7],[564,3,2010,14,0,0,0,0,0,3,47,0,45,563,6,0,142.0,67.7],[79,3,2006,13,0,0,0,0,0,0,0,0,50,657,3,1,131.7,62.8],[77,3,2006,12,0,0,0,0,0,0,0,0,21,235,2,1,54.5,26.0]],"LA|1":[[487,0,2006,16,370,588,4301,24,8,18,44,0,0,0,0,3,252.4,94.0],[565,0,2010,16,354,590,3512,18,15,27,63,1,0,0,0,2,190.8,66.3],[489,1,2006,16,0,0,0,0,0,346,1528,13,90,806,3,2,415.4,130],[566,1,2007,15,0,0,0,0,0,86,303,0,30,183,0,0,78.6,24.6],[567,1,2008,12,0,0,0,0,0,79,296,0,18,132,0,0,60.8,19.3],[568,1,2008,7,0,0,0,0,0,32,140,0,19,183,0,1,49.3,16.7],[493,2,2006,16,0,0,0,0,0,0,0,0,93,1188,10,1,269.8,97.0],[494,2,2006,16,0,1,0,0,0,0,0,0,74,1098,3,0,203.8,73.3],[569,2,2010,16,0,0,0,0,0,7,81,0,85,689,3,0,180.0,64.7],[570,2,2008,15,0,0,0,0,0,10,69,1,53,674,3,0,151.3,54.4],[571,2,2010,14,0,0,0,0,0,3,28,0,53,620,2,0,129.8,46.7],[495,2,2006,16,0,0,0,0,0,4,4,0,40,479,4,1,110.3,39.7],[413,2,2007,14,0,0,0,0,0,0,0,0,33,375,3,0,88.5,31.8],[572,2,2010,13,0,0,0,0,0,2,-14,0,34,344,2,0,79.0,28.4],[402,3,2007,16,0,0,0,0,0,0,0,0,39,429,3,0,99.9,47.6],[573,3,2010,16,0,0,0,0,0,0,0,0,41,391,2,0,92.1,43.9],[574,3,2006,13,0,0,0,0,0,0,0,0,20,226,1,0,48.6,23.2],[575,3,2010,7,0,0,0,0,0,0,0,0,13,146,3,0,45.6,21.7]],"WAS|1":[[576,0,2009,16,327,507,3618,20,15,46,236,1,0,0,0,4,216.3,79.8],[301,0,2010,13,275,472,3377,14,15,29,151,0,0,0,0,1,174.2,59.9],[42,0,2006,10,161,260,1789,8,4,13,34,0,0,0,0,1,101.0,37.3],[46,1,2007,16,1,1,15,1,0,325,1262,11,47,389,0,5,272.7,89.7],[577,1,2006,16,0,0,0,0,0,245,1154,4,53,445,1,3,236.9,82.8],[578,1,2010,10,0,0,0,0,0,164,742,4,18,125,2,1,138.7,48.2],[579,1,2010,14,0,0,0,0,0,65,261,3,39,309,2,1,124.0,41.3],[50,1,2009,16,0,0,0,0,0,64,228,0,27,242,1,0,80.0,25.6],[580,1,2009,8,0,0,0,0,0,62,201,3,9,99,0,0,57.0,17.3],[51,2,2010,16,0,0,0,0,0,5,-6,0,93,1115,6,2,235.9,84.8],[581,2,2010,15,0,0,0,0,0,0,0,0,44,871,3,1,147.1,52.9],[197,2,2008,16,3,4,46,1,0,1,5,0,53,593,4,0,142.6,51.3],[582,2,2009,13,0,0,0,0,0,3,-2,0,25,325,3,0,75.3,27.1],[583,2,2009,15,0,0,0,0,0,0,0,0,25,347,0,0,59.7,21.5],[445,2,2006,13,0,0,0,0,0,0,0,0,23,365,0,1,57.5,20.7],[89,2,2007,7,0,0,0,0,0,0,0,0,22,256,1,0,53.6,19.3],[59,3,2007,16,0,0,0,0,0,0,0,0,66,786,8,0,194.6,92.8],[584,3,2009,15,0,0,0,0,0,0,0,0,48,509,6,0,134.9,64.3],[61,3,2007,14,0,0,0,0,0,26,78,2,17,117,1,0,54.5,26.0]],"DET|1":[[223,0,2006,16,372,596,4208,21,22,34,156,2,0,0,0,9,217.9,77.9],[585,0,2010,11,257,416,2686,16,12,22,123,0,0,0,0,1,159.7,57.2],[586,0,2009,10,201,377,2267,13,20,20,108,2,0,0,0,1,125.5,36.2],[587,0,2008,10,143,255,1616,8,8,7,29,0,0,0,0,0,87.5,27.5],[152,1,2006,12,0,0,0,0,0,181,689,6,61,520,2,5,219.9,71.7],[588,1,2008,16,0,0,0,0,0,238,976,8,39,286,0,1,211.2,70.3],[589,1,2010,16,0,1,0,0,0,171,555,4,58,487,2,1,196.2,60.8],[590,1,2010,13,0,0,0,0,0,90,336,5,25,170,0,0,105.6,34.2],[103,1,2007,11,0,0,0,0,0,65,335,3,4,54,0,0,60.9,22.4],[224,1,2008,13,0,0,0,0,0,76,237,1,12,88,1,0,56.5,16.4],[591,2,2008,16,0,0,0,0,0,3,-1,0,78,1331,12,2,281.0,101.0],[158,2,2006,16,0,0,0,0,0,2,2,0,82,1310,7,2,251.2,90.3],[592,2,2006,16,0,0,0,0,0,0,0,0,98,1086,6,1,240.6,86.5],[497,2,2007,16,0,0,0,0,0,4,2,0,79,943,6,2,205.5,73.9],[337,2,2010,14,0,0,0,0,0,7,81,0,55,625,6,2,157.6,56.7],[177,2,2009,16,0,0,0,0,0,0,0,0,35,417,3,0,94.7,34.0],[367,2,2009,16,0,0,0,0,0,0,0,0,35,357,1,1,74.7,26.9],[593,3,2010,16,0,0,0,0,0,0,0,0,71,722,4,0,167.2,79.7],[519,3,2010,15,0,0,0,0,0,0,0,0,45,378,1,1,86.8,41.4],[594,3,2009,16,0,0,0,0,0,0,0,0,29,296,3,0,76.6,36.5],[146,3,2006,14,0,0,0,0,0,0,0,0,21,308,4,0,75.8,36.1]],"CHI|1":[[509,0,2009,16,336,555,3666,27,26,40,173,1,0,0,0,1,227.9,79.9],[510,0,2008,15,272,465,2972,18,12,24,49,3,0,0,0,5,181.8,63.4],[595,0,2006,16,262,480,3193,23,20,24,2,0,1,-4,0,5,170.5,56.3],[82,0,2007,7,161,262,1803,10,12,13,28,0,0,0,0,1,88.9,30.3],[596,1,2008,16,0,0,0,0,0,316,1238,8,63,477,4,1,304.5,100.6],[88,1,2006,16,1,1,-4,0,0,296,1210,6,36,154,0,1,206.2,68.6],[290,1,2007,16,1,1,9,1,0,151,510,3,51,420,0,2,162.4,50.7],[597,1,2006,15,0,0,0,0,0,157,647,6,8,54,0,0,114.1,37.9],[464,1,2010,16,0,0,0,0,0,112,267,3,20,139,0,0,78.6,20.0],[598,2,2007,16,0,0,0,0,0,0,0,0,71,951,5,1,194.1,69.8],[599,2,2010,16,0,0,0,0,0,1,2,0,51,960,5,1,175.2,63.0],[212,2,2006,16,0,0,0,0,0,0,0,0,60,863,5,1,174.3,62.7],[600,2,2009,13,0,0,0,0,0,6,-1,0,57,757,3,1,148.6,53.4],[601,2,2009,16,0,0,0,0,0,0,0,0,54,717,2,0,145.7,52.4],[602,2,2008,16,0,0,0,0,0,3,14,0,35,445,2,0,92.9,33.4],[445,2,2008,10,0,0,0,0,0,0,0,0,26,364,2,0,82.4,29.6],[603,2,2009,7,0,0,0,0,0,0,0,0,24,298,4,0,77.8,28.0],[604,3,2009,16,0,0,0,0,0,0,0,0,60,612,8,0,169.2,80.7],[297,3,2006,14,0,0,0,0,0,0,0,0,45,626,6,0,143.6,68.5]],"TEN|1":[[605,0,2006,15,185,357,2199,12,13,83,552,7,0,0,0,3,203.2,65.1],[130,0,2008,16,242,415,2676,12,7,25,49,0,0,0,0,1,145.9,50.6],[606,1,2009,16,0,1,0,0,0,358,2006,14,50,503,2,3,392.9,130],[427,1,2006,14,0,0,0,0,0,270,1211,7,18,78,0,1,188.9,65.2],[607,1,2008,16,0,0,0,0,0,200,773,15,5,16,0,1,171.9,55.6],[409,1,2007,12,0,0,0,0,0,102,462,5,19,128,0,1,106.0,36.6],[608,1,2010,16,0,0,0,0,0,51,239,2,7,44,0,0,47.3,16.7],[609,2,2010,11,0,0,0,0,0,0,0,0,42,775,9,1,173.5,62.4],[610,2,2007,15,0,0,0,0,0,2,-17,0,55,719,4,0,149.2,53.6],[611,2,2010,16,0,0,0,0,0,1,-8,0,42,687,6,0,145.9,52.5],[612,2,2007,16,0,0,0,0,0,0,0,0,55,750,2,0,142.0,51.1],[413,2,2006,13,0,0,0,0,0,0,0,0,46,737,3,1,137.7,49.5],[419,2,2008,16,0,0,0,0,0,2,35,0,41,449,1,0,95.4,34.3],[613,2,2006,16,0,0,0,0,0,0,0,0,33,461,2,0,91.1,32.8],[124,2,2008,14,0,0,0,0,0,2,8,0,30,412,0,2,68.0,24.4],[423,3,2008,16,0,0,0,0,0,0,0,0,58,561,2,0,126.1,60.1],[614,3,2010,15,0,0,0,0,0,0,0,0,29,361,1,0,71.1,33.9],[113,3,2008,12,0,0,0,0,0,0,0,0,24,257,1,0,55.7,26.6],[421,3,2006,10,0,0,0,0,0,0,0,0,13,150,2,0,40.0,19.1]],"CAR|1":[[204,0,2008,16,246,414,3288,15,12,20,21,2,0,0,0,2,177.6,63.6],[615,1,2008,16,0,0,0,0,0,273,1515,18,22,121,2,0,307.6,111.8],[616,1,2009,16,0,0,0,0,0,221,1133,10,18,139,1,2,207.2,75.3],[208,1,2006,14,0,0,0,0,0,227,897,3,32,159,0,2,151.6,49.3],[617,1,2010,16,0,0,0,0,0,103,452,3,40,310,0,3,128.2,43.7],[211,2,2006,14,0,0,0,0,0,8,61,1,83,1166,8,0,259.7,93.4],[212,2,2008,16,0,0,0,0,0,0,0,0,65,923,5,1,185.3,66.6],[12,2,2006,16,0,1,0,0,1,1,4,1,70,815,4,1,177.9,64.0],[618,2,2007,15,0,0,0,0,0,0,0,0,38,517,4,0,113.7,40.9],[619,2,2010,15,0,0,0,0,0,3,2,0,37,508,3,0,106.0,38.1],[620,2,2010,14,0,1,0,0,0,1,60,0,38,468,1,0,96.8,34.8],[215,2,2007,12,0,0,0,0,0,0,0,0,32,332,0,0,65.2,23.4],[621,3,2007,16,0,0,0,0,0,0,0,0,46,406,2,1,96.6,46.1],[622,3,2009,14,0,0,0,0,0,0,0,0,26,313,2,0,69.3,33.0],[219,3,2006,9,0,0,0,0,0,0,0,0,21,170,1,0,44.0,21.0],[623,3,2009,13,0,0,0,0,0,0,0,0,12,242,0,0,36.2,17.3]],"GB|1":[[624,0,2009,16,350,541,4434,30,7,58,316,5,0,0,0,4,343.0,129.9],[238,0,2007,16,356,535,4155,28,15,29,12,0,0,0,0,3,243.4,92.8],[625,1,2009,16,0,0,0,0,0,282,1253,11,25,197,0,1,234.0,80.1],[239,1,2006,14,0,0,0,0,0,266,1059,5,46,373,1,2,221.2,72.9],[626,1,2010,16,0,0,0,0,0,190,703,3,43,342,1,0,171.5,54.6],[502,1,2006,13,0,0,0,0,0,91,421,2,16,112,0,1,79.3,27.8],[627,1,2010,16,0,0,0,0,0,84,281,4,15,97,2,0,88.8,27.6],[628,1,2006,16,0,0,0,0,0,37,150,1,29,211,2,2,79.1,26.4],[629,2,2010,16,0,0,0,0,0,1,-1,0,76,1265,12,0,274.4,98.7],[245,2,2006,16,0,0,0,0,0,7,16,0,92,1295,8,0,271.1,97.5],[630,2,2010,16,0,0,0,0,0,0,0,0,50,679,5,1,145.9,52.5],[631,2,2010,16,0,0,0,0,0,0,0,0,45,582,2,3,109.2,39.3],[632,2,2007,11,0,0,0,0,0,0,0,0,16,242,4,0,64.2,23.1],[321,2,2007,9,0,0,0,0,0,1,5,0,21,241,1,0,51.6,18.6],[633,3,2009,12,0,0,0,0,0,0,0,0,55,676,5,1,150.6,71.8],[251,3,2007,15,0,0,0,0,0,0,0,0,48,575,6,1,139.5,66.5],[252,3,2006,8,0,0,0,0,0,0,0,0,21,198,2,0,52.8,25.2],[250,3,2007,7,0,0,0,0,0,0,0,0,18,132,3,0,49.2,23.5]],"ATL|1":[[634,0,2010,16,357,571,3705,28,9,46,122,0,0,0,0,4,250.4,92.6],[99,0,2006,16,205,389,2474,20,13,123,1039,2,1,1,0,3,264.0,89.6],[147,0,2007,12,215,348,2215,7,8,14,33,0,1,4,0,0,105.3,36.5],[635,0,2007,6,89,149,1079,10,5,8,16,0,0,0,0,1,72.8,26.9],[481,1,2008,16,0,0,0,0,0,376,1699,17,6,41,0,2,278.0,95.4],[84,1,2006,16,0,0,0,0,0,286,1140,4,22,170,1,0,183.0,60.1],[636,1,2008,16,0,0,0,0,0,95,489,4,36,338,2,0,154.7,54.8],[637,1,2009,14,0,0,0,0,0,142,613,4,30,259,1,1,145.2,49.3],[638,1,2006,16,0,0,0,0,0,19,106,1,23,168,3,0,74.4,25.9],[112,2,2010,16,0,0,0,0,0,1,3,0,115,1389,10,1,316.2,113.7],[111,2,2008,15,0,0,0,0,0,0,0,0,50,777,3,0,147.7,53.1],[572,2,2007,13,0,0,0,0,0,0,0,0,37,437,1,1,84.7,30.5],[639,2,2008,16,0,0,0,0,0,12,69,1,23,320,1,1,77.9,28.0],[353,2,2006,13,0,0,0,0,0,0,0,0,28,430,1,0,77.0,27.7],[33,2,2007,11,0,0,0,0,0,0,0,0,27,243,1,0,57.3,20.6],[108,2,2010,13,0,0,0,0,0,0,0,0,19,166,3,0,53.6,19.3],[38,3,2009,16,0,0,0,0,0,0,0,0,83,867,6,0,205.7,98.1],[113,3,2006,16,0,0,0,0,0,0,0,0,56,780,8,0,182.0,86.8],[557,3,2008,12,0,0,0,0,0,0,0,0,15,159,2,0,42.9,20.5]],"SEA|1":[[315,0,2007,16,352,562,3966,28,12,39,89,0,0,0,0,4,247.5,91.7],[640,0,2008,10,141,242,1532,11,3,16,78,0,0,0,0,3,101.1,36.3],[641,1,2009,16,0,0,0,0,0,114,619,4,41,350,1,1,165.9,60.1],[6,1,2009,14,0,0,0,0,0,177,663,2,35,232,2,0,148.5,47.3],[590,1,2007,13,0,0,0,0,0,140,628,4,23,213,1,1,135.1,46.6],[316,1,2006,10,0,0,0,0,0,252,896,7,12,48,0,3,142.4,43.7],[642,1,2010,12,0,0,0,0,0,165,573,6,21,138,0,3,122.1,37.2],[643,1,2007,15,0,0,0,0,0,33,146,1,39,313,0,0,90.9,30.8],[294,2,2007,16,0,0,0,0,0,0,0,0,94,1147,6,1,242.7,87.3],[320,2,2006,13,0,0,0,0,0,0,0,0,63,956,10,0,218.6,78.6],[229,2,2009,16,0,0,0,0,0,0,0,0,79,911,3,1,186.1,66.9],[337,2,2007,16,0,0,0,0,0,2,4,0,50,694,9,1,183.8,66.1],[71,2,2006,14,0,0,0,0,0,4,30,0,53,725,4,0,152.5,54.8],[644,2,2010,13,0,0,0,0,0,1,0,0,65,751,2,0,152.1,54.7],[324,2,2006,13,0,0,0,0,0,0,0,0,45,610,4,0,130.0,46.7],[645,2,2010,13,0,0,0,0,0,2,17,0,30,494,4,0,109.1,39.2],[646,3,2009,16,0,0,0,0,0,0,0,0,51,574,7,0,150.4,71.7],[325,3,2006,10,0,0,0,0,0,0,0,0,22,231,4,1,69.1,32.9],[165,3,2007,13,0,0,0,0,0,0,0,0,28,273,2,0,67.3,32.1],[594,3,2007,9,0,0,0,0,0,0,0,0,13,82,3,0,39.2,18.7]],"KC|1":[[558,0,2010,15,262,450,3116,27,7,33,125,0,0,0,0,1,229.1,83.9],[647,0,2008,14,230,420,2608,18,12,62,386,3,1,37,1,2,217.6,73.9],[392,0,2006,10,148,244,1878,11,1,9,9,0,2,-6,0,5,111.4,43.2],[25,1,2006,16,0,1,0,0,0,416,1789,17,41,410,2,2,370.9,125.3],[648,1,2010,16,0,0,0,0,0,230,1467,5,45,468,3,2,282.5,108.5],[88,1,2010,16,0,0,0,0,0,245,896,6,14,122,0,1,149.8,46.9],[649,1,2007,11,0,0,0,0,0,112,407,2,22,148,0,0,89.5,28.1],[650,2,2010,16,0,0,0,0,0,1,4,0,72,1162,15,0,278.6,100.2],[31,2,2006,16,0,0,0,0,0,4,16,0,53,860,5,0,170.6,61.3],[398,2,2009,9,0,0,0,0,0,0,0,0,36,608,4,0,120.8,43.4],[37,2,2006,16,0,0,0,0,0,3,7,0,41,561,1,0,103.8,37.3],[651,2,2008,8,1,1,37,1,0,0,0,0,30,380,3,0,91.5,32.9],[613,2,2009,12,0,0,0,0,0,3,11,0,36,367,2,1,83.8,30.1],[652,2,2007,16,0,0,0,0,0,1,5,0,28,313,1,1,63.8,22.9],[35,2,2006,15,0,0,0,0,0,3,11,0,26,204,2,1,63.5,22.8],[38,3,2008,16,0,0,0,0,0,0,0,0,96,1058,10,0,261.8,124.8],[653,3,2010,15,0,0,0,0,0,0,0,0,47,556,3,0,120.6,57.5],[654,3,2007,14,0,0,0,0,0,3,7,0,24,180,1,1,46.7,22.3],[655,3,2009,12,0,0,0,0,0,0,0,0,20,174,1,0,43.4,20.7]],"IND|1":[[375,0,2006,16,362,557,4397,31,9,23,36,4,0,0,0,1,309.5,117.4],[656,1,2007,15,0,0,0,0,0,261,1072,12,41,364,3,0,276.6,92.4],[377,1,2008,15,0,0,0,0,0,152,538,6,45,302,3,0,185.0,59.0],[657,1,2007,16,0,0,0,0,0,121,533,3,13,77,1,0,98.0,33.7],[658,1,2010,13,0,0,0,0,0,129,497,2,20,205,0,0,102.2,32.9],[659,1,2010,10,0,0,0,0,0,46,112,6,9,63,0,1,60.5,17.8],[381,2,2007,16,0,0,0,0,0,1,4,0,104,1510,10,3,309.4,111.2],[380,2,2006,16,0,0,0,0,0,0,0,0,95,1366,12,1,301.6,108.4],[660,2,2010,14,0,0,0,0,0,2,6,0,67,784,6,0,182.0,65.4],[661,2,2009,16,0,0,0,0,0,2,1,0,60,676,7,0,169.7,61.0],[662,2,2008,16,0,0,0,0,0,0,0,0,57,664,4,0,147.4,53.0],[663,2,2010,13,0,0,0,0,0,0,0,0,36,355,5,0,101.5,36.5],[388,3,2009,16,0,0,0,0,0,2,11,0,100,1106,10,0,271.7,129.6],[664,3,2010,13,0,0,0,0,0,0,0,0,67,631,4,0,154.1,73.5],[665,3,2007,14,0,0,0,0,0,0,0,0,31,364,1,0,73.4,35.0],[389,3,2006,10,0,0,0,0,0,0,0,0,18,202,2,0,50.2,23.9]],"CLE|1":[[666,0,2007,16,298,527,3787,29,19,32,70,3,0,0,0,2,252.5,88.8],[667,0,2006,13,252,393,2454,10,17,47,215,3,0,0,0,7,129.7,44.7],[668,0,2010,8,135,222,1576,6,9,28,136,1,1,13,0,0,90.9,30.9],[669,0,2009,10,136,256,1339,8,7,20,98,1,1,18,0,3,84.2,24.1],[515,1,2010,16,1,2,13,0,0,270,1177,11,61,477,2,5,294.9,100.1],[462,1,2007,15,0,0,0,0,0,298,1304,9,30,248,2,2,247.2,84.1],[670,1,2009,14,0,0,0,0,0,194,862,5,34,220,2,2,180.2,62.0],[347,1,2006,14,0,0,0,0,0,220,758,4,27,169,0,4,135.7,40.8],[671,1,2007,16,0,0,0,0,0,60,277,1,24,233,0,2,77.0,26.6],[370,2,2007,16,0,0,0,0,0,0,0,0,80,1289,16,2,300.9,108.2],[92,2,2007,16,0,0,0,0,0,0,0,0,50,614,3,0,131.4,47.2],[672,2,2009,16,0,0,0,0,0,1,-3,0,34,624,3,1,112.1,40.3],[673,2,2009,16,1,4,18,0,1,55,381,1,20,135,1,2,102.3,36.8],[674,2,2010,13,0,0,0,0,0,0,0,0,29,310,3,0,78.0,28.0],[675,2,2010,16,0,0,0,0,0,3,9,1,40,346,0,2,77.5,27.9],[367,2,2006,13,0,0,0,0,0,3,32,0,22,228,0,1,46.0,16.5],[529,3,2007,16,0,0,0,0,0,0,0,0,82,1106,5,1,222.6,106.1],[79,3,2010,16,0,0,0,0,0,1,-1,0,68,763,3,0,162.2,77.3],[371,3,2006,15,0,0,0,0,0,0,0,0,36,249,2,0,72.9,34.8],[676,3,2010,9,0,0,0,0,0,0,0,0,16,322,1,1,52.2,24.9]],"NO|1":[[473,0,2009,15,363,514,4388,34,11,22,33,2,1,-4,0,6,293.4,116.1],[677,1,2006,16,0,1,0,0,1,155,565,6,88,742,2,2,266.7,87.0],[451,1,2006,15,0,0,0,0,0,244,1057,10,30,198,0,1,213.5,72.5],[678,1,2009,14,0,0,0,0,0,147,793,6,39,302,2,1,194.5,70.8],[452,1,2007,16,0,0,0,0,0,115,448,5,36,211,0,1,129.9,42.5],[679,1,2010,12,0,0,0,0,0,137,716,5,1,17,0,2,100.3,38.0],[513,1,2009,13,0,0,0,0,0,172,654,5,4,12,0,2,96.6,30.2],[680,2,2007,16,0,0,0,0,0,0,0,0,98,1202,11,1,282.2,101.5],[681,2,2008,16,0,1,0,0,1,0,0,0,79,928,10,0,229.8,82.6],[682,2,2009,15,0,0,0,0,0,6,82,0,45,722,9,1,177.4,63.8],[72,2,2007,15,0,0,0,0,0,2,-5,0,54,792,3,1,148.7,53.5],[683,2,2009,16,0,0,0,0,0,4,13,0,51,804,2,0,144.7,52.0],[33,2,2006,10,0,1,0,0,0,0,0,0,37,679,4,0,130.9,47.1],[684,2,2006,13,0,0,0,0,0,1,8,0,23,385,3,2,76.3,27.4],[144,3,2009,13,0,0,0,0,0,0,0,0,48,569,3,0,122.9,58.6],[507,3,2008,12,0,0,0,0,0,0,0,0,45,579,1,0,108.9,51.9],[447,3,2007,14,0,0,0,0,0,0,0,0,48,378,2,0,97.8,46.6],[685,3,2010,12,0,0,0,0,0,1,3,0,31,356,5,0,96.9,46.2]],"ARI|1":[[132,0,2008,16,401,598,4583,30,14,18,-2,0,0,0,0,7,261.1,99.7],[686,0,2006,12,214,377,2547,11,12,22,49,2,0,0,0,2,134.8,44.4],[666,0,2010,12,169,327,2065,7,10,5,25,0,0,0,0,2,91.1,24.6],[687,1,2009,16,0,0,0,0,0,143,598,8,63,428,0,4,205.6,69.0],[376,1,2007,16,0,0,0,0,0,324,1222,7,24,204,0,0,208.6,67.4],[688,1,2009,16,0,0,0,0,0,176,793,7,12,143,0,2,143.6,49.9],[171,1,2008,11,0,1,0,0,0,31,187,1,29,255,1,0,91.2,32.4],[689,1,2010,13,0,0,0,0,0,23,113,1,16,111,0,0,56.4,19.5],[172,2,2008,16,0,0,0,0,0,0,0,0,96,1431,12,0,311.1,111.9],[174,2,2008,12,0,0,0,0,0,9,67,0,89,1038,11,3,259.5,93.3],[690,2,2008,16,0,0,0,0,0,2,8,0,77,1006,3,0,196.4,70.6],[177,2,2006,16,0,0,0,0,0,1,-3,0,40,740,4,1,135.7,48.8],[691,2,2008,14,1,1,18,0,0,0,0,0,34,448,4,0,103.5,37.2],[692,2,2010,15,0,0,0,0,0,0,0,0,24,307,2,1,64.7,23.3],[693,2,2010,10,0,0,0,0,0,2,5,0,26,291,1,0,61.6,22.1],[386,2,2006,15,0,0,0,0,0,0,0,0,23,209,2,0,55.9,20.1],[655,3,2007,12,0,0,0,0,0,0,0,0,23,238,5,1,74.8,35.7],[694,3,2009,8,0,0,0,0,0,0,0,0,12,146,2,0,38.6,18.4]],"MIN|1":[[238,0,2009,16,363,531,4202,33,7,9,7,0,1,-2,0,3,281.6,110.3],[41,0,2006,15,270,439,2750,9,15,29,82,1,0,0,0,0,130.2,44.0],[695,0,2007,12,171,294,1911,9,12,54,260,3,0,0,0,3,130.4,42.6],[149,0,2008,11,178,301,2157,12,15,19,7,1,0,0,0,0,111.0,36.6],[696,1,2009,16,0,0,0,0,0,314,1383,18,43,436,0,6,320.9,109.1],[464,1,2006,15,0,0,0,0,0,303,1216,6,42,288,0,3,222.4,73.5],[333,1,2006,16,1,1,15,1,0,24,131,0,46,468,1,0,122.5,42.2],[697,1,2010,15,0,0,0,0,0,81,322,1,21,167,0,3,69.9,22.9],[698,2,2009,16,0,1,0,0,0,0,0,0,83,1312,8,1,260.2,93.6],[699,2,2010,14,0,0,0,0,0,18,107,1,71,868,5,1,210.5,75.7],[598,2,2008,16,0,0,0,0,0,4,26,0,48,964,7,1,193.0,69.4],[339,2,2006,16,0,0,0,0,0,1,5,0,57,651,3,2,136.6,49.1],[613,2,2007,16,0,0,0,0,0,1,-9,0,54,647,3,1,133.8,48.1],[292,2,2006,8,0,0,0,0,0,0,0,0,29,381,4,0,91.1,32.8],[700,2,2006,12,0,0,0,0,0,0,0,0,37,455,0,0,82.5,29.7],[249,2,2007,11,0,0,0,0,0,0,0,0,32,391,1,0,77.1,27.7],[701,3,2009,16,0,0,0,0,0,0,0,0,56,566,11,0,178.6,85.2],[342,3,2006,15,0,0,0,0,0,0,0,0,46,386,1,0,90.6,43.2]],"CIN|1":[[222,0,2006,16,324,520,4035,28,13,26,37,0,0,0,0,7,237.1,88.5],[702,0,2008,12,221,372,1905,8,9,60,304,2,1,-3,0,5,123.3,40.2],[224,1,2006,16,0,0,0,0,0,341,1309,12,23,124,0,2,234.3,76.5],[48,1,2007,16,0,0,0,0,0,178,763,7,52,374,0,2,203.7,68.9],[597,1,2009,13,0,0,0,0,0,301,1251,6,17,111,0,0,189.2,63.2],[566,1,2009,14,0,0,0,0,0,27,84,0,30,217,0,1,60.1,19.3],[703,1,2010,16,0,0,0,0,0,61,299,1,11,60,0,1,50.9,18.4],[225,1,2008,13,0,0,0,0,0,104,269,2,20,71,0,3,60.0,14.9],[229,2,2007,16,0,0,0,0,0,5,14,0,112,1143,12,1,297.7,107.0],[228,2,2007,16,0,0,0,0,0,6,47,0,93,1440,8,1,287.7,103.4],[305,2,2010,13,0,0,0,0,0,0,0,0,72,983,9,0,224.3,80.6],[233,2,2006,11,0,0,0,0,0,0,0,0,36,605,9,0,150.5,54.1],[704,2,2010,15,0,0,0,0,0,0,0,0,52,600,3,0,130.0,46.7],[52,2,2009,15,0,0,0,0,0,2,10,0,43,514,5,0,125.4,45.1],[705,2,2009,16,0,0,0,0,0,3,22,0,51,432,3,2,110.4,39.7],[706,2,2010,4,0,0,0,0,0,1,2,0,20,277,3,2,61.9,22.3],[707,3,2010,15,0,0,0,0,0,0,0,0,52,471,4,1,123.1,58.7],[708,3,2009,15,0,0,0,0,0,0,0,0,27,260,2,1,63.0,30.0],[114,3,2006,13,0,0,0,0,0,0,0,0,21,254,1,0,52.4,25.0]],"BAL|1":[[709,0,2010,16,306,489,3622,25,10,43,84,1,0,0,0,4,231.3,86.4],[405,0,2006,16,295,468,3050,16,12,45,119,1,0,0,0,1,177.9,64.5],[461,0,2007,12,168,275,1743,9,10,19,89,0,0,0,0,4,86.6,29.2],[710,1,2009,16,0,1,0,0,0,254,1339,7,78,702,1,2,326.1,116.3],[428,1,2007,15,0,0,0,0,0,294,1207,7,43,231,1,3,228.8,76.3],[711,1,2008,16,0,0,0,0,0,232,902,10,19,123,1,0,187.5,61.0],[462,1,2006,16,0,0,0,0,0,314,1132,9,18,115,0,2,192.7,61.0],[712,1,2007,16,0,0,0,0,0,75,264,2,27,192,0,0,84.6,26.8],[713,1,2006,13,0,0,0,0,0,12,50,0,21,182,2,1,54.2,18.2],[414,2,2007,16,0,0,0,0,0,0,0,0,103,1087,5,1,239.7,86.2],[467,2,2006,16,0,1,0,0,0,7,-30,0,67,939,5,0,187.9,67.6],[174,2,2010,16,1,1,-6,0,0,2,2,0,64,837,7,1,187.7,67.5],[235,2,2009,15,0,0,0,0,0,1,1,0,34,431,2,0,89.2,32.1],[229,2,2010,16,0,0,0,0,0,0,0,0,30,398,3,0,87.8,31.6],[714,2,2006,14,0,0,0,0,0,0,0,0,22,396,2,0,73.6,26.5],[715,2,2007,11,0,0,0,0,0,0,0,0,18,326,3,0,68.6,24.7],[470,3,2006,16,0,0,0,0,0,0,0,0,73,765,6,0,185.5,88.5],[716,3,2007,12,0,0,0,0,0,0,0,0,34,246,1,1,62.6,29.8],[472,3,2006,14,0,0,0,0,0,0,0,0,20,166,3,2,50.6,24.1]],"LAC|1":[[717,0,2010,16,357,541,4710,30,13,29,52,0,0,0,0,4,281.6,108.0],[476,1,2006,16,2,3,20,2,0,348,1815,28,56,508,3,1,481.1,130],[718,1,2010,15,0,0,0,0,0,182,735,11,25,216,0,3,182.1,60.2],[719,1,2009,16,0,0,0,0,0,93,343,3,45,497,4,0,177.0,58.0],[720,1,2010,12,0,0,0,0,0,158,678,7,22,145,0,3,140.3,47.5],[481,1,2006,13,0,0,0,0,0,80,502,2,3,47,0,0,69.9,28.6],[721,1,2006,16,0,0,0,0,0,29,140,1,17,83,0,0,45.3,15.8],[722,2,2009,15,0,0,0,0,0,3,11,0,68,1167,9,0,239.8,86.2],[723,2,2010,11,0,0,0,0,0,0,0,0,37,717,6,0,144.7,52.0],[398,2,2007,10,0,0,0,0,0,2,17,0,35,555,4,0,116.2,41.8],[483,2,2006,15,0,0,0,0,0,2,19,0,48,659,0,0,115.8,41.6],[543,2,2010,8,0,1,0,0,0,0,0,0,28,514,1,0,85.4,30.7],[89,2,2006,14,0,0,0,0,0,1,8,0,36,437,0,2,76.5,27.5],[724,2,2010,9,0,0,0,0,0,3,-2,0,23,371,1,1,65.9,23.7],[725,2,2010,7,0,0,0,0,0,0,0,0,21,259,1,0,52.9,19.0],[486,3,2009,16,0,0,0,0,0,0,0,0,79,1157,8,0,242.7,115.7],[402,3,2010,15,0,0,0,0,0,0,0,0,20,221,2,0,54.1,25.8],[498,3,2006,8,0,0,0,0,0,1,1,0,14,91,3,0,41.2,19.6]],"PHI|1":[[99,0,2010,12,233,372,3018,21,6,99,676,9,0,0,0,3,310.3,116.6],[301,0,2008,16,345,571,3916,23,11,39,147,2,0,0,0,5,243.3,88.0],[358,0,2006,8,116,188,1309,10,2,25,87,0,0,0,0,2,95.1,36.5],[302,1,2007,15,0,0,0,0,0,278,1333,7,90,771,5,2,368.4,127.6],[726,1,2010,15,0,0,0,0,0,207,1080,7,78,592,2,1,297.2,106.2],[303,1,2008,14,0,0,0,0,0,76,369,2,26,324,2,0,119.3,41.7],[643,1,2009,16,0,0,0,0,0,70,323,2,15,140,2,0,85.3,29.6],[727,2,2009,15,0,0,0,0,0,11,137,1,62,1156,9,1,261.3,93.9],[728,2,2010,16,0,0,0,0,0,3,36,0,70,964,10,1,228.0,82.0],[495,2,2007,16,0,0,0,0,0,0,0,0,77,1110,6,0,224.0,80.5],[309,2,2006,16,0,0,0,0,0,3,24,1,46,816,8,0,184.0,66.2],[455,2,2006,11,0,0,0,0,0,0,0,0,38,725,5,0,140.5,50.5],[729,2,2009,16,0,0,0,0,0,0,0,0,41,587,3,0,119.7,43.0],[730,2,2008,15,0,0,0,0,0,0,0,0,33,440,3,0,95.0,34.2],[310,2,2006,15,0,0,0,0,0,0,0,0,24,348,2,1,68.8,24.7],[731,3,2009,16,0,0,0,0,0,0,0,0,76,971,8,0,221.1,105.4],[312,3,2006,14,0,0,0,0,0,0,0,0,50,611,5,0,143.1,68.2],[236,3,2006,13,0,0,0,0,0,0,0,0,14,214,2,0,47.4,22.6]],"LV|1":[[576,0,2010,13,194,329,2387,13,8,47,222,1,0,0,0,1,157.7,56.2],[732,0,2008,15,199,368,2423,13,8,17,127,1,0,0,0,7,137.6,45.3],[327,0,2007,7,109,186,1331,5,5,20,40,3,0,0,0,3,79.2,27.1],[167,0,2007,9,110,190,1151,10,11,29,143,0,0,0,0,4,72.3,22.8],[733,1,2010,13,0,1,0,0,0,223,1157,7,47,507,3,3,267.4,96.0],[734,1,2007,14,0,0,0,0,0,222,1009,4,23,188,0,1,164.7,57.4],[735,1,2010,14,0,0,0,0,0,158,655,8,18,194,0,0,150.9,50.4],[121,1,2007,11,0,0,0,0,0,144,549,3,28,247,0,0,125.6,40.4],[736,1,2010,16,0,0,0,0,0,30,122,1,25,333,3,1,92.5,31.0],[638,1,2007,13,0,0,0,0,0,7,27,0,26,165,1,0,51.2,17.2],[278,2,2007,16,0,1,0,0,0,1,1,0,55,717,4,0,154.8,55.7],[276,2,2007,16,0,0,0,0,0,0,0,0,44,705,6,0,150.5,54.1],[737,2,2010,16,0,0,0,0,0,10,155,2,25,470,2,2,125.5,45.1],[738,2,2010,14,0,0,0,0,0,1,43,0,41,609,2,1,116.2,41.8],[277,2,2006,12,0,0,0,0,0,0,0,0,42,553,3,0,115.3,41.5],[739,2,2008,16,0,0,0,0,0,3,34,0,22,366,4,1,102.0,36.7],[740,2,2009,8,0,0,0,0,0,0,0,0,29,365,2,0,77.5,27.9],[741,2,2010,14,0,0,0,0,0,4,48,0,26,366,1,1,71.4,25.7],[742,3,2009,15,0,0,0,0,0,0,0,0,66,805,3,0,164.5,78.4],[283,3,2006,11,0,0,0,0,0,0,0,0,25,285,2,0,65.5,31.2],[743,3,2006,14,0,0,0,0,0,0,0,0,28,293,0,2,53.3,25.4]],"HOU|1":[[744,0,2009,16,396,583,4770,29,15,48,57,0,0,0,0,2,280.5,107.4],[499,0,2006,16,302,442,2767,11,12,53,195,2,0,0,0,6,152.2,57.1],[745,0,2007,9,154,240,1684,15,12,21,51,1,0,0,0,3,110.5,41.0],[746,1,2010,16,0,0,0,0,0,327,1616,16,66,604,2,2,392.0,130],[747,1,2008,16,0,0,0,0,0,268,1282,9,50,377,1,2,271.9,95.0],[135,1,2007,13,0,0,0,0,0,194,773,6,17,112,0,0,141.5,46.2],[748,1,2006,13,0,0,0,0,0,124,476,4,33,204,0,1,125.0,40.6],[749,1,2009,14,0,0,0,0,0,101,390,4,13,106,1,1,90.6,29.3],[524,1,2010,16,0,0,0,0,0,50,315,4,7,61,0,0,68.6,26.3],[503,2,2008,16,0,0,0,0,0,0,0,0,115,1575,8,1,320.5,115.2],[750,2,2008,16,0,0,0,0,0,3,23,0,60,899,8,0,200.2,72.0],[368,2,2007,14,0,0,0,0,0,0,0,0,33,583,3,0,129.3,46.5],[751,2,2010,15,0,0,0,0,0,2,7,0,51,562,3,0,127.9,46.0],[430,2,2006,15,0,0,0,0,0,1,6,0,57,557,1,0,119.3,42.9],[752,2,2009,16,0,0,0,0,0,0,0,0,38,370,0,0,75.0,27.0],[753,3,2008,16,0,0,0,0,0,0,0,0,70,862,2,1,166.2,79.2],[754,3,2010,16,0,0,0,0,0,0,0,0,36,518,4,1,109.8,52.4]],"BUF|1":[[702,0,2010,13,255,441,3000,23,15,40,269,0,0,0,0,5,198.9,69.9],[755,0,2006,16,268,429,3051,19,14,38,140,1,0,0,0,7,176.0,64.2],[756,0,2008,14,245,374,2699,11,10,36,117,3,0,0,0,5,153.7,57.5],[642,1,2008,15,0,0,0,0,0,250,1036,8,47,300,1,1,232.6,77.8],[757,1,2009,16,1,1,27,1,0,237,1062,2,46,371,2,2,214.4,73.7],[428,1,2006,14,0,0,0,0,0,259,990,6,18,156,0,2,164.6,52.9],[287,1,2006,14,0,0,0,0,0,107,378,2,22,139,0,1,83.7,25.9],[758,1,2010,14,0,0,0,0,0,74,283,0,24,157,1,3,74.0,24.0],[431,2,2006,16,0,1,0,0,0,0,0,0,82,1292,8,1,257.2,92.5],[759,2,2010,16,0,0,0,0,0,0,0,0,82,1073,10,1,247.3,88.9],[305,2,2009,16,0,0,0,0,0,6,54,1,55,829,5,0,179.3,64.5],[432,2,2008,13,0,0,0,0,0,0,0,0,56,597,1,0,121.7,43.8],[109,2,2006,16,0,0,0,0,0,5,18,0,49,402,3,1,107.0,38.5],[760,2,2007,15,0,0,0,0,0,3,19,1,35,352,1,0,90.1,32.4],[761,2,2010,14,0,0,0,0,0,0,0,0,31,353,3,0,84.3,30.3],[762,2,2010,13,0,0,0,0,0,3,1,0,18,213,1,0,45.4,16.3],[763,3,2008,13,0,0,0,0,0,0,0,0,33,351,1,2,70.1,33.4],[220,3,2007,15,0,0,0,0,0,0,0,0,25,215,2,0,58.5,27.9],[764,3,2009,12,0,0,0,0,0,0,0,0,17,156,1,1,36.6,17.5],[765,3,2008,9,0,0,0,0,0,0,0,0,15,153,1,0,36.3,17.3]],"JAX|1":[[255,0,2010,14,236,366,2734,23,15,66,279,5,0,0,0,4,221.3,82.8],[254,0,2006,6,108,183,1159,7,5,25,41,2,0,0,0,0,80.5,27.8],[766,0,2007,8,80,144,986,10,5,19,57,0,0,0,0,1,73.1,25.6],[767,1,2009,16,0,0,0,0,0,312,1391,15,53,374,1,1,323.5,110.4],[256,1,2006,15,0,0,0,0,0,231,1146,5,23,242,1,1,195.8,70.5],[768,1,2010,12,0,0,0,0,0,84,459,4,26,223,0,0,118.2,43.0],[258,1,2007,15,0,0,0,0,0,42,119,2,11,99,2,0,56.8,17.3],[769,2,2009,15,0,0,0,0,0,0,0,0,63,869,7,1,189.9,68.3],[770,2,2010,16,0,0,0,0,0,12,114,0,66,820,4,1,187.4,67.4],[264,2,2007,14,0,0,0,0,0,1,8,0,38,629,10,2,157.7,56.7],[263,2,2008,12,0,0,0,0,0,0,0,0,65,761,2,1,151.1,54.3],[367,2,2007,15,0,0,0,0,0,6,27,0,44,601,4,0,130.8,47.0],[493,2,2009,15,0,0,0,0,0,0,0,0,51,722,0,1,121.2,43.6],[262,2,2007,16,0,0,0,0,0,0,0,0,45,518,3,0,114.8,41.3],[771,3,2010,16,0,0,0,0,0,0,0,0,58,700,10,2,184.0,87.7],[268,3,2006,15,0,0,0,0,0,0,0,0,39,353,3,0,92.3,44.0],[772,3,2009,13,0,0,0,0,0,1,3,0,21,212,2,0,54.5,26.0]],"PIT|1":[[185,0,2009,15,337,506,4328,26,12,40,82,2,0,0,0,3,267.3,102.7],[188,1,2006,16,0,0,0,0,0,337,1494,13,31,222,3,5,288.6,98.4],[773,1,2010,16,0,0,0,0,0,324,1273,13,23,167,0,2,241.0,79.3],[333,1,2008,16,0,0,0,0,0,140,588,5,40,320,1,0,166.8,56.0],[243,1,2007,15,0,0,0,0,0,107,499,5,18,184,2,0,128.3,44.6],[774,1,2010,16,0,0,0,0,0,52,247,0,9,72,2,0,52.9,18.7],[775,2,2010,16,0,0,0,0,0,5,39,0,60,1257,10,0,249.6,89.7],[194,2,2009,16,0,0,0,0,0,0,0,0,95,1167,6,1,245.7,88.3],[776,2,2009,16,0,1,0,0,0,3,6,0,79,1248,5,0,234.4,84.3],[611,2,2008,14,0,0,0,0,0,5,18,0,40,631,3,0,122.9,44.2],[198,2,2006,14,1,1,21,0,0,2,14,0,37,504,1,1,93.6,33.7],[777,2,2010,13,0,0,0,0,0,0,0,0,28,376,2,1,75.6,27.2],[197,2,2010,16,2,2,42,2,0,1,2,0,22,253,0,0,57.2,20.6],[200,3,2009,16,0,0,0,0,0,0,0,0,76,789,6,0,190.9,91.0]],"NYJ|1":[[238,0,2008,16,343,522,3472,22,22,21,43,1,0,2,0,2,191.4,69.9],[778,0,2010,15,278,507,3291,17,13,30,105,3,0,0,0,1,202.1,68.2],[116,0,2006,16,313,485,3352,17,16,35,109,0,0,7,0,4,173.7,63.5],[779,0,2007,10,130,250,1529,5,10,27,111,1,0,0,0,1,76.3,19.6],[88,1,2008,16,0,0,0,0,0,290,1312,13,36,207,2,1,275.9,94.7],[476,1,2010,15,0,0,0,0,0,219,914,6,52,368,0,0,216.2,72.4],[780,1,2008,16,0,0,0,0,0,76,448,6,47,355,2,2,179.3,64.3],[781,1,2010,15,0,0,0,0,0,185,766,2,16,120,0,2,112.6,37.4],[122,1,2006,8,0,0,0,0,0,113,374,5,7,43,0,0,78.7,23.3],[439,1,2006,12,0,0,0,0,0,131,370,6,7,21,0,0,82.1,21.9],[52,2,2006,16,0,0,0,0,0,2,14,0,91,1098,6,0,238.2,85.6],[782,2,2006,16,0,0,0,0,0,5,25,0,82,961,6,0,216.6,77.9],[370,2,2010,16,0,0,0,0,0,1,4,0,53,904,7,1,185.8,66.8],[776,2,2010,12,0,0,0,0,0,2,17,0,52,746,6,2,160.3,57.6],[675,2,2008,12,0,0,0,0,0,1,1,0,32,359,3,0,86.0,30.9],[783,2,2007,15,0,1,0,0,0,12,45,0,32,325,2,0,81.0,29.1],[124,2,2006,12,0,0,0,0,0,0,0,0,23,347,1,0,63.7,22.9],[784,3,2010,15,0,0,0,0,0,0,0,0,55,687,5,0,153.7,73.3],[129,3,2007,15,0,0,0,0,0,0,0,0,41,409,3,1,97.9,46.7]],"SF|1":[[785,0,2006,16,258,442,2890,16,16,44,147,2,0,0,0,5,164.3,55.8],[585,0,2008,9,181,288,2046,13,8,24,115,2,0,0,0,2,137.3,51.1],[786,0,2008,9,128,220,1678,8,11,30,145,0,0,0,0,6,81.6,26.7],[787,0,2010,6,73,145,1176,5,4,23,121,1,0,0,0,0,77.1,25.1],[440,1,2006,16,0,0,0,0,0,312,1695,8,61,485,1,5,323.0,116.2],[302,1,2010,13,0,0,0,0,0,77,340,4,16,150,1,0,95.0,32.4],[208,1,2008,11,0,0,0,0,0,76,234,1,16,133,1,1,62.7,18.4],[788,1,2009,13,0,0,0,0,0,83,226,1,11,76,0,0,47.2,12.0],[494,2,2008,16,0,1,0,0,0,1,-3,0,61,835,7,0,186.2,66.9],[789,2,2010,16,0,0,0,0,0,0,0,0,55,741,6,0,165.1,59.4],[446,2,2006,16,0,1,0,0,0,5,25,0,59,686,3,1,146.1,52.5],[15,2,2006,14,0,0,0,0,0,0,0,0,40,733,3,0,131.3,47.2],[790,2,2009,15,0,0,0,0,0,5,61,0,52,527,3,0,128.8,46.3],[177,2,2008,13,0,0,0,0,0,0,0,0,45,546,3,0,117.6,42.3],[320,2,2007,15,0,0,0,0,0,0,0,0,46,497,3,0,113.7,40.9],[791,2,2008,16,0,0,0,0,0,2,5,0,30,317,2,0,74.2,26.7],[792,3,2009,16,0,0,0,0,0,0,0,0,78,965,13,0,252.5,120.4],[447,3,2006,11,0,0,0,0,0,0,0,0,34,292,2,0,75.2,35.9],[793,3,2010,14,0,0,0,0,0,3,18,0,29,331,0,1,61.9,29.5]],"GB|2":[[624,0,2011,15,343,502,4643,45,6,60,257,3,0,0,0,0,397.4,130],[794,1,2014,16,0,0,0,0,0,246,1139,9,42,427,4,2,272.6,98.9],[795,1,2015,16,0,0,0,0,0,148,601,2,43,392,3,3,166.3,57.9],[625,1,2011,15,0,0,0,0,0,134,559,2,19,268,1,1,117.7,41.3],[796,1,2012,11,0,0,0,0,0,135,464,0,18,125,0,0,76.9,23.7],[627,1,2011,15,0,0,0,0,0,30,78,4,15,77,2,0,66.5,21.9],[597,1,2012,5,0,0,0,0,0,71,248,1,14,97,0,0,54.5,17.6],[631,2,2014,16,0,0,0,0,0,0,0,0,98,1519,13,0,327.9,109.3],[797,2,2014,16,0,0,0,0,0,11,37,0,91,1287,12,2,293.4,97.8],[630,2,2012,15,0,0,0,0,0,0,0,0,64,784,14,0,226.4,75.5],[629,2,2011,13,0,0,0,0,0,0,0,0,67,949,9,0,215.9,72.0],[798,2,2013,15,0,0,0,0,0,0,0,0,49,681,3,0,135.1,45.0],[245,2,2011,16,0,0,0,0,0,0,0,0,37,445,6,0,117.5,39.2],[799,2,2015,13,0,0,0,0,0,0,0,0,50,483,1,0,106.3,35.4],[633,3,2011,16,0,0,0,0,0,0,0,0,55,767,8,0,179.7,79.5],[800,3,2015,16,0,0,0,0,0,1,11,0,58,510,8,0,160.1,70.9],[801,3,2014,16,0,0,0,0,0,0,0,0,29,323,3,0,79.3,35.1],[802,3,2012,10,0,0,0,0,0,0,0,0,8,203,3,0,46.3,20.5]],"ATL|2":[[634,0,2012,16,422,615,4719,32,14,34,141,1,0,0,0,2,304.9,97.3],[803,1,2015,15,0,0,0,0,0,265,1056,11,73,578,3,2,316.4,110.1],[481,1,2011,16,0,0,0,0,0,301,1340,11,17,168,0,2,229.8,82.6],[804,1,2012,16,0,0,0,0,0,94,362,1,53,402,1,0,141.4,48.7],[489,1,2013,12,0,0,0,0,0,157,543,6,33,191,1,0,148.4,48.5],[637,1,2013,13,0,0,0,0,0,44,164,1,29,216,3,0,91.0,31.4],[805,1,2014,10,0,0,0,0,0,23,144,2,13,222,3,1,77.6,28.9],[806,2,2015,16,0,0,0,0,0,0,0,0,136,1871,8,1,369.1,123.0],[112,2,2011,16,0,0,0,0,0,0,0,0,100,1296,8,0,277.6,92.5],[639,2,2013,16,0,0,0,0,0,0,0,0,85,1067,2,2,199.7,66.6],[600,2,2014,16,0,0,0,0,0,6,36,1,38,504,2,1,114.0,38.0],[807,2,2015,7,0,0,0,0,0,0,0,0,26,327,3,0,76.7,25.6],[808,2,2013,10,0,0,0,0,0,0,0,0,22,210,1,1,47.0,15.7],[809,2,2013,12,0,0,0,0,0,0,0,0,12,216,2,0,45.6,15.2],[38,3,2012,16,0,0,0,0,0,0,0,0,93,930,8,0,234.0,103.6],[664,3,2015,15,0,0,0,0,0,0,0,0,59,657,1,0,130.7,57.9],[810,3,2014,15,0,0,0,0,0,0,0,0,31,238,2,1,64.8,28.7]],"TEN|2":[[811,0,2015,12,230,370,2818,19,10,34,252,2,1,41,1,6,211.0,64.5],[315,0,2011,16,319,518,3571,18,14,20,52,0,0,0,0,1,190.0,55.4],[702,0,2013,11,217,350,2454,14,12,43,225,3,1,0,0,2,167.7,48.8],[812,0,2012,11,177,314,2176,10,11,41,291,1,0,0,0,4,132.1,33.6],[606,1,2013,16,0,0,0,0,0,279,1077,6,42,345,4,2,240.2,82.4],[813,1,2015,14,1,1,41,1,0,143,520,3,21,174,0,1,112.0,36.8],[814,1,2014,16,0,0,0,0,0,152,569,2,18,133,0,2,96.2,31.6],[608,1,2011,12,0,0,0,0,0,59,185,1,28,187,0,1,69.2,22.3],[781,1,2013,11,0,0,0,0,0,77,295,4,6,39,0,0,63.4,21.4],[780,1,2014,16,0,0,0,0,0,13,57,0,22,159,2,1,53.6,19.0],[611,2,2011,16,0,0,0,0,0,2,5,1,74,1023,7,0,224.8,74.9],[815,2,2013,16,0,0,0,0,0,0,0,0,94,1079,2,0,213.9,71.3],[816,2,2011,15,0,0,0,0,0,0,0,0,45,592,5,0,134.2,44.7],[609,2,2012,14,0,0,0,0,0,0,0,0,45,589,4,1,127.9,42.6],[817,2,2015,14,0,0,0,0,0,0,0,0,32,549,4,0,112.9,37.6],[818,2,2011,15,0,0,0,0,0,0,0,0,47,470,1,0,100.0,33.3],[819,2,2014,12,0,0,0,0,0,0,0,0,28,498,3,0,95.8,31.9],[820,2,2015,11,0,0,0,0,0,55,247,1,31,260,1,2,91.7,30.6],[793,3,2015,15,0,0,0,0,0,1,36,0,94,1088,6,0,244.4,108.2],[614,3,2011,16,0,0,0,0,0,0,0,0,49,759,3,2,138.9,61.5],[556,3,2015,14,0,0,0,0,0,0,0,0,26,289,2,0,66.9,29.6],[821,3,2012,15,0,0,0,0,0,0,0,0,23,275,1,0,56.5,25.0]],"PIT|2":[[185,0,2014,16,408,608,4952,32,9,33,27,0,0,-6,0,5,306.2,98.3],[822,1,2014,16,0,0,0,0,0,290,1361,8,83,854,3,0,370.5,130],[615,1,2015,16,0,0,0,0,0,200,907,11,40,367,0,2,231.4,83.7],[773,1,2011,15,0,0,0,0,0,228,928,9,18,154,0,1,178.2,61.9],[823,1,2012,13,0,0,0,0,0,156,623,2,18,106,0,2,98.9,33.8],[774,1,2011,16,0,0,0,0,0,110,479,3,18,78,0,2,87.7,31.5],[523,1,2014,10,0,0,0,0,0,65,266,2,6,36,0,1,46.2,16.0],[824,2,2015,16,0,0,0,0,0,3,28,0,136,1834,10,2,388.2,129.4],[775,2,2011,16,0,0,0,0,0,5,57,0,72,1193,8,1,243.0,81.0],[777,2,2013,16,0,0,0,0,0,1,25,0,67,740,6,0,181.5,60.5],[825,2,2015,11,0,0,0,0,0,5,37,1,50,765,6,1,170.2,56.7],[782,2,2013,15,0,0,0,0,0,1,-5,0,46,602,10,0,165.7,55.2],[826,2,2015,16,0,0,0,0,0,0,0,0,44,749,5,0,150.9,50.3],[194,2,2011,14,0,0,0,0,0,0,0,0,46,381,2,1,94.1,31.4],[741,2,2015,14,0,0,0,0,0,0,0,0,21,314,2,0,64.4,21.5],[200,3,2012,15,0,0,0,0,0,0,0,0,71,816,8,0,202.6,89.7]],"BAL|2":[[709,0,2014,16,344,554,3986,27,12,39,70,2,0,0,0,0,262.4,79.7],[710,1,2011,16,1,1,1,1,0,291,1364,12,76,704,3,2,372.8,130],[641,1,2014,16,0,0,0,0,0,235,1266,8,44,263,0,0,246.9,94.8],[827,1,2015,16,0,0,0,0,0,137,514,1,45,353,2,2,145.7,49.3],[828,1,2015,16,0,0,0,0,0,2,3,0,41,321,4,0,97.4,34.1],[829,1,2012,15,0,0,0,0,0,108,532,1,7,47,0,0,70.9,27.6],[393,1,2011,16,0,0,0,0,0,108,444,2,13,83,0,2,73.7,25.6],[211,2,2014,16,0,0,0,0,0,0,0,0,79,1065,6,1,219.5,73.2],[830,2,2013,16,0,0,0,0,0,0,0,0,65,1128,4,0,203.8,67.9],[831,2,2015,16,0,0,0,0,0,0,0,0,75,944,5,1,197.4,65.8],[174,2,2012,15,0,0,0,0,0,1,3,0,65,921,4,0,183.4,61.1],[832,2,2013,14,0,0,0,0,0,1,-2,0,49,524,7,0,145.2,48.4],[751,2,2013,12,0,0,0,0,0,2,0,0,37,455,2,0,100.5,33.5],[833,2,2015,8,0,0,0,0,0,0,0,0,31,363,0,0,67.3,22.4],[834,2,2015,12,0,0,0,0,0,3,-6,0,19,346,1,0,59.0,19.7],[835,3,2012,16,0,0,0,0,0,0,0,0,61,669,7,0,169.9,75.2],[836,3,2011,16,0,0,0,0,0,0,0,0,54,528,5,0,136.8,60.6],[753,3,2014,15,0,0,0,0,0,0,0,0,48,527,4,0,124.7,55.2],[837,3,2015,10,0,0,0,0,0,0,0,0,33,412,4,0,98.2,43.5]],"NE|2":[[63,0,2011,16,401,611,5235,39,12,43,109,3,0,0,0,2,366.3,116.3],[838,1,2012,16,0,0,0,0,0,290,1263,12,6,51,0,2,205.4,73.4],[839,1,2014,16,0,0,0,0,0,96,391,2,52,447,3,0,165.8,58.0],[560,1,2012,15,0,0,0,0,0,76,301,4,40,446,3,0,156.7,54.6],[559,1,2011,16,0,0,0,0,0,181,667,11,9,159,0,0,157.6,52.5],[523,1,2013,16,0,0,0,0,0,153,772,7,2,38,0,2,121.0,46.9],[840,1,2015,7,0,0,0,0,0,49,234,2,36,388,2,1,120.2,43.3],[553,2,2011,16,0,0,0,0,0,4,30,0,122,1569,9,0,335.9,112.0],[841,2,2013,16,0,0,0,0,0,2,11,0,105,1056,6,0,251.7,83.9],[620,2,2014,16,0,0,0,0,0,2,13,0,74,953,7,1,210.6,70.2],[445,2,2012,16,0,0,0,0,0,0,0,0,74,911,4,0,189.1,63.0],[71,2,2011,14,0,0,0,0,0,0,0,0,51,702,5,0,151.2,50.4],[569,2,2015,14,1,1,36,0,0,2,11,0,65,648,3,1,148.3,49.4],[842,2,2013,11,0,0,0,0,0,0,0,0,37,519,4,0,112.9,37.6],[843,2,2013,11,0,0,0,0,0,0,0,0,32,466,4,0,102.6,34.2],[563,3,2011,16,0,0,0,0,0,1,2,1,90,1327,17,0,330.9,130],[564,3,2011,14,0,0,0,0,0,5,45,0,79,910,7,1,214.5,95.0],[844,3,2014,13,0,0,0,0,0,1,-2,0,26,259,6,0,87.7,38.8],[845,3,2015,12,0,0,0,0,0,0,0,0,23,259,4,0,72.9,32.3]],"KC|2":[[785,0,2015,16,307,470,3486,20,7,84,498,2,0,0,0,0,271.2,84.9],[558,0,2011,9,160,269,1713,10,9,25,99,0,1,-4,0,2,97.0,25.5],[648,1,2013,15,0,0,0,0,0,259,1287,12,70,693,7,2,378.0,130],[846,1,2015,15,0,0,0,0,0,160,634,4,20,214,1,1,132.8,45.5],[847,1,2014,16,0,0,0,0,0,134,463,6,16,147,1,2,121.0,39.3],[848,1,2015,9,0,0,0,0,0,72,403,6,6,5,0,0,82.8,32.5],[849,1,2011,15,0,0,0,0,0,149,597,2,9,68,0,0,87.5,29.9],[850,1,2012,16,0,0,0,0,0,59,233,2,24,158,0,1,73.1,25.3],[728,2,2015,15,0,0,0,0,0,3,14,0,87,1088,8,1,243.2,81.1],[650,2,2011,16,0,0,0,0,0,1,12,0,81,1159,5,0,228.1,76.0],[690,2,2011,16,0,0,0,0,0,1,25,0,61,785,2,0,154.0,51.3],[820,2,2011,16,0,0,0,0,0,114,516,1,46,328,1,3,136.4,45.5],[570,2,2013,15,0,0,0,0,0,2,6,0,40,596,2,1,110.2,36.7],[851,2,2015,14,0,0,0,0,0,5,26,0,35,451,2,0,94.7,31.6],[852,2,2014,12,0,0,0,0,0,14,113,1,23,156,0,0,61.9,20.6],[853,2,2012,14,0,0,0,0,0,0,0,0,20,325,1,0,58.5,19.5],[854,3,2015,16,0,0,0,0,0,0,0,0,72,875,5,2,189.5,83.9],[653,3,2012,14,0,0,0,0,0,0,0,0,33,453,1,0,84.3,37.3],[556,3,2014,14,0,0,0,0,0,0,0,0,25,226,4,0,71.6,31.7],[855,3,2013,13,0,0,0,0,0,0,0,0,26,302,2,0,68.2,30.2]],"NYJ|2":[[702,0,2015,16,335,562,3905,31,15,60,270,2,0,0,0,2,285.2,84.7],[778,0,2011,16,308,543,3474,26,18,37,103,6,0,0,0,8,237.3,66.4],[856,0,2013,16,247,443,3046,12,21,72,366,6,1,13,0,4,194.7,50.0],[679,1,2015,15,0,0,0,0,0,247,1070,7,30,217,1,2,202.7,72.3],[781,1,2011,16,0,0,0,0,0,253,1054,6,30,211,0,0,192.5,67.6],[857,1,2015,11,0,0,0,0,0,70,313,1,47,388,2,0,135.1,48.2],[476,1,2011,14,0,0,0,0,0,75,280,1,42,449,2,0,132.9,45.7],[606,1,2014,16,0,0,0,0,0,155,663,1,24,151,1,1,115.4,41.0],[516,2,2015,16,0,0,0,0,0,0,0,0,109,1502,14,2,339.2,113.1],[858,2,2015,15,0,0,0,0,0,0,0,0,80,1027,12,1,252.7,84.2],[776,2,2011,16,0,0,0,0,0,3,27,0,51,654,8,1,165.1,55.0],[141,2,2011,16,0,0,0,0,0,0,0,0,45,612,8,0,154.2,51.4],[859,2,2012,16,1,1,42,0,0,5,8,0,56,827,2,3,153.2,51.1],[761,2,2013,12,0,0,0,0,0,0,0,0,36,423,2,0,90.3,30.1],[699,2,2014,8,0,0,0,0,0,22,110,0,29,350,1,0,81.0,27.0],[740,2,2012,12,0,0,0,0,0,0,0,0,28,289,2,1,66.9,22.3],[784,3,2011,16,0,0,0,0,0,0,0,0,65,815,5,1,174.5,77.2],[860,3,2013,13,0,0,0,0,0,0,0,0,26,398,4,0,89.8,39.8],[861,3,2014,14,0,0,0,0,0,0,0,0,38,345,2,0,84.5,37.4],[529,3,2013,12,0,0,0,0,0,0,0,0,31,388,2,0,81.8,36.2]],"PHI|2":[[862,0,2013,13,203,317,2891,27,2,57,221,3,0,0,0,2,259.7,87.7],[99,0,2011,13,253,423,3303,18,14,76,589,1,0,0,0,4,233.0,68.3],[565,0,2015,14,346,532,3725,19,14,26,39,0,0,0,0,3,194.9,59.4],[778,0,2014,9,198,309,2418,14,11,34,87,1,0,0,0,3,139.4,43.0],[726,1,2013,16,0,0,0,0,0,314,1607,9,52,539,2,1,330.6,122.5],[863,1,2015,15,0,0,0,0,0,193,702,6,44,322,1,2,184.4,61.4],[719,1,2014,15,0,0,0,0,0,57,329,6,40,387,0,1,157.6,58.5],[720,1,2015,13,0,0,0,0,0,106,539,6,20,146,1,3,124.5,46.9],[864,1,2012,16,0,0,0,0,0,115,564,4,13,56,0,3,93.0,35.4],[865,1,2014,11,0,0,0,0,0,46,172,4,2,16,0,0,50.8,17.2],[728,2,2014,16,0,0,0,0,0,0,0,0,85,1318,10,0,276.8,92.3],[727,2,2013,16,0,0,0,0,0,3,2,0,82,1332,9,0,269.4,89.8],[866,2,2013,16,0,0,0,0,0,0,18,0,47,835,8,0,184.3,61.4],[729,2,2011,16,0,0,0,0,0,0,0,0,52,679,1,1,123.9,41.3],[867,2,2015,15,0,0,0,0,0,0,0,0,27,312,3,0,76.2,25.4],[868,2,2015,13,0,0,0,0,0,0,0,0,23,283,1,1,55.3,18.4],[869,2,2012,14,0,0,0,0,0,3,12,0,19,256,0,2,47.8,15.9],[870,3,2015,16,0,0,0,0,0,0,0,0,85,997,8,1,230.7,102.1],[731,3,2011,16,0,0,0,0,0,0,0,0,62,811,5,0,173.1,76.6],[871,3,2015,15,0,0,0,0,0,0,0,0,75,853,2,1,170.3,75.4],[872,3,2012,11,0,0,0,0,0,0,0,0,25,186,2,1,53.6,23.7]],"CAR|2":[[873,0,2015,16,296,495,3837,35,10,132,636,10,0,0,0,4,389.1,119.0],[616,1,2011,16,0,0,0,0,0,142,761,4,47,413,1,0,194.4,73.9],[615,1,2011,16,0,0,0,0,0,155,836,7,16,135,0,0,155.1,60.7],[718,1,2013,16,0,0,0,0,0,101,361,5,27,184,2,0,123.5,41.4],[211,2,2011,16,0,0,0,0,0,6,56,0,79,1394,7,2,264.0,88.0],[874,2,2014,16,0,0,0,0,0,0,0,0,73,1008,9,1,225.8,75.3],[552,2,2015,15,0,0,0,0,0,4,60,0,44,739,10,0,183.9,61.3],[620,2,2013,15,0,0,0,0,0,2,15,0,49,627,5,0,143.2,47.7],[782,2,2014,15,0,0,0,0,0,0,0,0,48,580,1,0,114.0,38.0],[875,2,2015,16,0,0,0,0,0,0,0,0,31,473,5,1,106.3,35.4],[876,2,2015,14,0,0,0,0,0,6,38,0,31,447,4,0,103.5,34.5],[724,2,2011,15,1,1,27,0,0,0,0,0,44,467,1,0,97.8,32.6],[604,3,2015,16,0,0,0,0,0,0,0,0,77,1104,7,1,227.4,100.7],[144,3,2011,15,0,0,0,0,0,0,0,0,37,455,4,1,104.5,46.3],[836,3,2015,16,0,0,0,0,0,0,0,0,17,121,2,0,41.1,18.2]],"WAS|2":[[877,0,2012,15,258,393,3200,20,5,120,815,7,0,0,0,2,317.5,100.8],[878,0,2015,16,379,543,4166,29,11,26,48,5,0,0,0,3,293.4,95.0],[595,0,2011,13,265,458,3151,16,20,20,11,1,0,0,0,4,149.1,38.9],[879,1,2012,16,0,0,0,0,0,335,1613,13,11,77,0,3,252.0,92.8],[880,1,2011,15,0,0,0,0,0,151,640,2,49,379,1,2,164.9,58.3],[881,1,2015,13,0,0,0,0,0,144,490,3,19,304,1,4,114.4,36.5],[882,1,2015,13,0,0,0,0,0,35,216,0,35,240,2,0,92.6,34.9],[687,1,2011,5,0,0,0,0,0,84,321,1,10,78,1,0,61.9,20.8],[883,1,2011,6,0,0,0,0,0,56,328,0,9,68,0,0,48.6,20.2],[660,2,2013,16,0,0,0,0,0,2,19,0,113,1346,5,1,277.5,92.5],[727,2,2014,15,0,0,0,0,0,4,7,0,56,1169,6,0,209.6,69.9],[504,2,2011,16,0,0,0,0,0,0,0,0,68,947,5,1,190.7,63.6],[51,2,2012,16,0,0,0,0,0,3,14,0,41,573,8,1,145.7,48.6],[884,2,2015,16,0,1,0,0,0,2,2,0,59,604,2,1,133.6,44.5],[790,2,2012,16,0,1,0,0,0,3,25,0,48,510,2,0,113.5,37.8],[807,2,2012,15,0,0,0,0,0,2,5,0,38,543,3,0,110.8,36.9],[692,2,2014,16,0,0,0,0,0,2,21,0,36,453,2,2,91.4,30.5],[885,3,2015,14,0,0,0,0,0,0,0,0,87,952,11,2,244.2,108.1],[584,3,2011,12,0,0,0,0,0,0,0,0,59,796,3,1,154.6,68.4],[886,3,2014,16,0,0,0,0,0,0,0,0,39,507,1,1,93.7,41.5],[887,3,2013,15,0,0,0,0,0,0,0,0,28,267,3,2,68.7,30.4]],"IND|2":[[888,0,2014,16,380,616,4761,40,16,64,273,3,0,0,0,6,351.7,107.8],[315,0,2015,8,156,256,1690,9,5,16,15,0,0,0,0,2,91.1,26.2],[889,0,2011,9,132,243,1541,6,9,17,107,0,0,0,0,3,72.3,14.5],[440,1,2015,16,0,0,0,0,0,260,967,6,34,267,1,3,193.4,65.0],[658,1,2013,16,0,0,0,0,0,102,537,6,27,214,2,0,150.1,56.4],[531,1,2014,10,0,0,0,0,0,90,425,2,38,300,6,2,154.5,56.0],[890,1,2012,16,0,0,0,0,0,211,814,2,17,152,1,0,131.6,44.1],[891,1,2014,15,0,0,0,0,0,159,519,3,27,229,0,1,117.8,36.6],[892,1,2014,14,0,0,0,0,0,78,351,1,21,173,0,2,75.4,27.3],[381,2,2012,16,0,0,0,0,0,1,-5,0,106,1355,5,1,269.0,89.7],[893,2,2014,15,0,0,0,0,0,2,20,0,82,1345,7,1,258.5,86.2],[660,2,2011,16,0,0,0,0,0,4,28,0,70,947,6,2,199.5,66.5],[894,2,2015,16,0,0,0,0,0,0,0,0,64,733,6,0,173.3,57.8],[570,2,2012,16,0,0,0,0,0,4,9,0,60,781,3,0,157.0,52.3],[503,2,2015,16,0,0,0,0,0,0,0,0,41,503,4,0,115.3,38.4],[661,2,2011,16,0,0,0,0,0,0,0,0,54,514,1,0,111.4,37.1],[533,2,2014,15,0,0,0,0,0,0,0,0,38,405,4,0,102.5,34.2],[895,3,2014,16,0,0,0,0,0,0,0,0,51,774,8,0,176.4,78.1],[896,3,2014,12,0,0,0,0,0,0,0,0,29,395,8,0,116.5,51.6],[388,3,2011,10,0,0,0,0,0,0,0,0,34,352,2,1,79.2,35.1],[664,3,2011,13,0,0,0,0,0,0,0,0,19,177,1,0,42.7,18.9]],"ARI|2":[[222,0,2015,16,342,537,4671,35,11,25,24,1,0,0,0,2,309.2,98.2],[897,0,2011,9,146,253,1955,9,8,17,65,0,0,0,0,3,98.7,26.7],[898,0,2014,9,132,240,1711,7,5,25,63,0,0,0,0,0,94.7,24.3],[899,0,2011,8,151,275,1913,11,14,28,128,0,0,0,0,1,103.3,23.7],[900,1,2015,16,0,0,0,0,0,125,581,8,36,457,4,1,215.8,77.9],[901,1,2013,15,0,0,0,0,0,118,652,3,39,371,1,0,165.3,63.4],[688,1,2011,14,0,0,0,0,0,245,1047,10,10,52,0,2,175.9,62.5],[773,1,2013,15,0,0,0,0,0,217,687,8,18,134,0,3,144.1,44.0],[606,1,2015,11,0,0,0,0,0,196,814,3,6,58,0,2,107.2,37.5],[689,1,2012,14,0,0,0,0,0,110,356,4,17,106,0,0,87.2,27.2],[172,2,2015,16,0,0,0,0,0,0,0,0,109,1215,9,2,280.5,93.5],[902,2,2015,15,0,0,0,0,0,3,22,0,65,1003,7,1,207.5,69.2],[903,2,2013,16,0,0,0,0,0,0,0,0,65,1041,5,0,199.1,66.4],[692,2,2012,15,0,0,0,0,0,4,29,0,64,759,5,0,172.8,57.6],[693,2,2011,16,0,0,0,0,0,0,0,0,54,689,5,0,152.9,51.0],[904,2,2014,14,0,0,0,0,0,0,0,0,22,229,2,0,56.9,19.0],[905,2,2015,11,0,0,0,0,0,1,0,0,11,299,2,1,50.9,17.0],[906,3,2013,13,0,0,0,0,0,0,0,0,39,454,1,0,90.4,40.0],[646,3,2014,16,0,0,0,0,0,0,0,0,33,350,1,0,76.0,33.6],[621,3,2011,14,0,0,0,0,0,0,0,0,27,271,3,0,72.1,31.9],[907,3,2015,12,0,0,0,0,0,0,0,0,21,311,3,0,70.1,31.0]],"NO|2":[[473,0,2011,16,469,657,5476,46,14,21,86,1,0,0,0,1,391.6,127.6],[719,1,2011,16,0,0,0,0,0,87,603,2,86,710,7,0,277.3,105.5],[908,1,2015,12,0,0,0,0,0,166,769,6,50,405,0,1,203.4,74.0],[678,1,2013,16,0,0,0,0,0,147,549,2,77,513,3,1,211.2,72.2],[687,1,2015,6,0,0,0,0,0,96,375,4,12,129,0,0,86.4,29.5],[758,1,2015,13,0,0,0,0,0,36,112,0,34,239,2,0,81.1,27.3],[909,1,2014,14,0,0,0,0,0,10,32,0,38,296,1,2,72.8,25.3],[680,2,2012,16,0,0,0,0,0,0,0,0,83,1154,10,2,254.4,84.8],[910,2,2015,16,0,0,0,0,0,8,18,0,84,1138,9,0,253.6,84.5],[681,2,2012,15,0,0,0,0,0,0,0,0,65,1041,6,0,205.1,68.4],[911,2,2015,15,0,0,0,0,0,0,0,0,69,984,3,1,183.4,61.1],[912,2,2014,15,0,0,0,0,0,1,-2,0,63,931,3,0,173.9,58.0],[682,2,2011,16,0,0,0,0,0,4,18,0,40,620,6,0,139.8,46.6],[683,2,2011,15,0,0,0,0,0,1,9,0,32,503,2,0,95.2,31.7],[913,2,2015,16,0,0,0,0,0,0,0,0,30,454,2,0,87.4,29.1],[685,3,2013,16,0,0,0,0,0,0,0,0,86,1215,16,0,303.5,130],[79,3,2015,16,0,0,0,0,0,0,0,0,74,825,6,1,190.5,84.3],[914,3,2014,14,0,0,0,0,0,0,0,0,14,176,5,0,61.6,27.3],[915,3,2012,10,0,0,0,0,0,0,0,0,11,86,4,0,43.6,19.3]],"DET|2":[[586,0,2011,16,422,663,5038,41,16,22,78,0,0,0,0,1,343.3,106.3],[677,1,2013,14,0,0,0,0,0,223,1006,4,54,506,3,4,239.2,86.3],[916,1,2013,16,0,0,0,0,0,166,650,8,53,547,0,3,216.7,74.8],[917,1,2015,16,0,0,0,0,0,43,133,0,80,697,3,1,179.0,61.5],[918,1,2012,14,0,0,0,0,0,215,798,9,34,214,0,3,183.2,61.3],[588,1,2011,7,0,0,0,0,0,72,356,4,22,179,3,1,115.5,42.5],[919,1,2015,16,0,0,0,0,0,143,597,2,25,183,1,2,117.0,41.1],[591,2,2011,16,0,0,0,0,0,1,11,0,96,1681,16,1,359.2,119.7],[920,2,2014,16,0,0,0,0,0,5,30,0,99,1331,4,0,259.1,86.4],[337,2,2011,16,0,0,0,0,0,11,85,0,73,757,3,1,173.2,57.7],[921,2,2011,16,0,0,0,0,0,2,15,0,48,607,6,0,148.2,49.4],[922,2,2013,16,0,0,0,0,0,0,0,0,38,490,2,1,97.0,32.3],[681,2,2015,13,0,0,0,0,0,0,0,0,29,337,4,1,84.7,28.2],[923,2,2012,8,0,0,0,0,0,0,0,0,22,310,2,0,65.0,21.7],[924,2,2014,16,0,0,0,0,0,2,-1,0,24,314,1,2,57.3,19.1],[593,3,2011,16,0,0,0,0,0,0,0,0,83,777,5,0,190.7,84.4],[925,3,2015,14,0,0,0,0,0,0,0,0,47,537,5,0,130.7,57.9],[519,3,2011,15,0,0,0,0,0,1,5,0,26,347,6,0,99.2,43.9],[926,3,2013,13,0,0,0,0,0,0,0,0,18,207,7,0,82.7,36.6]],"LAC|2":[[717,0,2013,16,378,544,4478,32,11,28,72,0,0,-9,0,2,287.4,94.2],[720,1,2011,14,0,0,0,0,0,222,1091,6,50,455,0,2,236.6,88.0],[560,1,2015,16,0,0,0,0,0,98,336,3,80,755,6,0,243.1,83.2],[718,1,2011,15,0,0,0,0,0,121,490,8,54,433,2,1,204.3,71.4],[927,1,2014,14,0,0,0,0,0,160,582,3,36,271,1,0,145.3,48.2],[394,1,2012,14,0,0,0,0,0,46,220,0,49,371,0,0,108.1,39.0],[928,1,2015,14,0,0,0,0,0,184,641,0,33,192,0,4,108.3,33.8],[722,2,2011,16,0,0,0,0,0,3,51,0,60,1106,9,0,229.7,76.6],[929,2,2013,15,0,0,0,0,0,0,0,0,71,1046,8,2,219.6,73.2],[517,2,2014,16,0,0,0,0,0,3,14,0,62,778,7,1,181.2,60.4],[723,2,2014,16,0,0,0,0,0,0,0,0,52,856,6,0,173.6,57.9],[930,2,2012,10,0,1,0,0,0,0,0,0,37,658,7,0,144.8,48.3],[759,2,2015,9,0,0,0,0,0,0,0,0,45,497,3,0,112.7,37.6],[931,2,2015,13,0,0,0,0,0,0,0,0,35,486,3,1,99.6,33.2],[932,2,2013,16,0,0,0,0,0,0,0,0,41,472,1,0,94.2,31.4],[486,3,2014,16,0,0,0,0,0,0,0,0,69,821,12,0,223.1,98.8],[933,3,2015,13,0,0,0,0,0,0,0,0,37,429,4,0,107.9,47.8],[402,3,2011,15,0,0,0,0,0,0,0,0,30,271,0,0,57.1,25.3],[622,3,2012,11,0,0,0,0,0,0,0,0,10,95,3,1,35.5,15.7]],"DAL|2":[[539,0,2014,15,304,435,3705,34,9,26,61,0,0,0,0,3,266.3,90.3],[863,1,2014,16,0,0,0,0,0,392,1845,13,57,416,0,5,351.1,127.0],[733,1,2015,16,0,1,0,0,0,239,1089,3,40,328,0,3,195.7,71.3],[540,1,2011,12,0,0,0,0,0,127,575,1,33,221,0,2,114.6,41.7],[934,1,2015,6,0,0,0,0,0,76,315,4,10,86,0,0,74.1,26.0],[935,1,2015,4,0,0,0,0,0,5,67,0,21,215,0,0,49.2,18.8],[544,2,2014,16,0,0,0,0,0,0,0,0,88,1320,16,0,316.0,105.3],[572,2,2011,14,0,0,0,0,0,0,0,0,54,858,11,0,205.8,68.6],[542,2,2012,16,0,0,0,0,0,0,0,0,66,943,6,1,194.3,64.8],[936,2,2015,16,0,0,0,0,0,0,0,0,52,840,3,0,154.0,51.3],[937,2,2015,16,0,0,0,0,0,0,0,0,52,536,5,2,131.6,43.9],[938,2,2012,14,0,0,0,0,0,2,9,0,32,436,4,0,100.5,33.5],[939,2,2012,15,0,0,0,0,0,0,0,0,17,222,1,0,53.2,17.7],[18,3,2012,16,0,0,0,0,0,0,0,0,110,1039,3,0,231.9,102.7],[940,3,2014,12,0,0,0,0,0,0,0,0,9,105,4,0,43.5,19.3]],"TB|2":[[941,0,2015,16,312,535,4042,22,15,54,213,6,0,0,0,2,275.0,80.0],[520,0,2012,16,306,558,4065,27,17,39,139,0,0,0,0,2,248.5,70.0],[942,0,2013,13,247,416,2608,19,9,27,37,0,0,0,0,4,158.0,45.4],[167,0,2014,11,184,327,2206,11,14,25,127,3,0,0,0,4,126.9,31.0],[943,1,2012,16,0,0,0,0,0,319,1454,11,49,472,1,1,311.6,112.1],[944,1,2015,16,0,0,0,0,0,107,529,0,51,561,4,2,180.0,66.0],[523,1,2011,14,0,0,0,0,0,184,781,5,15,148,0,3,131.9,46.7],[945,1,2014,15,0,1,0,0,0,94,406,1,33,315,1,3,111.1,39.5],[946,1,2011,16,0,0,0,0,0,31,105,0,41,291,0,0,80.6,27.6],[522,1,2011,7,0,0,0,0,0,37,206,0,26,163,0,0,62.9,23.8],[722,2,2012,16,0,0,0,0,0,0,0,0,72,1384,8,0,260.4,86.8],[947,2,2014,15,0,0,0,0,0,0,0,0,68,1051,12,0,245.1,81.7],[525,2,2012,16,1,1,28,0,0,0,0,0,63,996,9,0,217.7,72.6],[948,2,2011,16,0,0,0,0,0,1,-3,0,40,554,3,1,111.1,37.0],[949,2,2011,14,0,0,0,0,0,0,0,0,35,387,6,0,109.7,36.6],[950,2,2013,12,0,0,0,0,0,0,0,0,24,440,4,0,92.0,30.7],[526,2,2011,14,0,0,0,0,0,6,-7,0,30,441,3,0,91.4,30.5],[738,2,2014,11,0,0,0,0,0,0,0,0,31,380,2,0,81.0,27.0],[529,3,2011,16,0,0,0,0,0,0,0,0,75,763,2,1,165.3,73.2],[844,3,2013,14,0,0,0,0,0,1,2,0,54,571,5,0,141.3,62.5],[388,3,2012,16,0,0,0,0,0,0,0,0,47,435,4,0,114.5,50.7],[951,3,2015,7,0,0,0,0,0,0,0,0,21,338,4,0,78.8,34.9]],"HOU|2":[[744,0,2012,16,350,544,4008,22,12,21,-9,0,1,-6,0,0,223.8,69.0],[702,0,2014,12,197,312,2483,17,8,50,184,2,0,0,0,1,179.7,56.6],[952,0,2015,11,224,369,2606,19,7,15,44,0,0,0,0,2,166.6,50.6],[953,0,2013,8,137,253,1760,9,6,14,72,1,0,0,0,2,103.6,26.3],[746,1,2011,13,0,0,0,0,0,278,1224,10,53,617,2,2,305.1,108.8],[954,1,2011,15,0,0,0,0,0,175,942,4,13,98,0,3,135.0,54.4],[955,1,2015,14,0,0,0,0,0,183,698,2,15,109,1,1,111.7,37.0],[956,1,2015,13,0,1,0,0,0,56,282,1,26,173,1,0,85.5,31.7],[865,1,2015,15,0,0,0,0,0,99,334,1,16,109,1,0,72.3,22.8],[641,1,2012,14,0,0,0,0,0,63,374,1,3,38,0,0,50.2,21.3],[957,2,2015,16,0,0,0,0,0,0,0,0,111,1521,11,0,331.1,110.4],[503,2,2012,16,0,0,0,0,0,0,0,0,112,1598,4,0,295.8,98.6],[611,2,2015,13,0,0,0,0,0,0,0,0,47,658,4,0,136.8,45.6],[958,2,2015,11,1,1,21,1,0,10,47,0,42,484,2,1,109.9,36.6],[750,2,2012,16,0,0,0,0,0,0,0,0,41,518,2,0,104.8,34.9],[751,2,2011,16,0,0,0,0,0,4,17,0,31,512,2,0,101.9,34.0],[869,2,2014,16,0,0,0,0,0,5,19,0,31,331,1,0,72.0,24.0],[959,2,2013,16,0,0,0,0,0,0,0,0,22,253,2,1,63.3,21.1],[753,3,2012,15,0,0,0,0,0,0,0,0,62,716,6,0,169.6,75.1],[960,3,2013,12,0,0,0,0,0,0,0,0,49,545,5,1,131.5,58.2],[754,3,2011,16,0,0,0,0,0,0,0,0,28,353,6,0,99.3,44.0],[961,3,2012,16,0,0,0,0,0,1,6,0,34,330,3,0,85.6,37.9]],"MIN|2":[[962,0,2015,16,292,447,3231,14,9,44,192,3,0,0,0,3,200.4,61.8],[963,0,2012,16,300,483,2935,18,12,60,253,2,1,-15,0,5,194.2,56.5],[558,0,2013,9,153,254,1807,11,9,18,57,1,0,0,0,1,108.0,30.5],[696,1,2012,16,0,0,0,0,0,348,2097,12,40,217,1,2,347.4,130],[964,1,2014,15,0,0,0,0,0,164,570,9,44,312,1,1,194.2,64.5],[965,1,2013,16,0,0,0,0,0,12,158,3,45,469,4,0,161.7,60.5],[697,1,2011,15,0,0,0,0,0,109,531,1,23,190,3,0,119.1,44.4],[966,1,2014,11,0,0,0,0,0,113,538,0,27,135,0,0,94.3,35.3],[699,2,2011,16,0,0,0,0,0,52,345,2,87,967,6,2,268.2,89.4],[629,2,2013,15,0,0,0,0,0,0,0,0,68,804,4,0,172.4,57.5],[967,2,2015,13,0,0,0,0,0,3,13,0,52,720,4,0,149.3,49.8],[706,2,2013,16,0,0,0,0,0,0,0,0,48,726,1,0,126.6,42.2],[968,2,2014,15,0,0,0,0,0,5,71,0,42,588,2,0,119.9,40.0],[775,2,2015,15,0,0,0,0,0,1,6,0,39,473,2,0,98.9,33.0],[111,2,2012,16,0,0,0,0,0,0,0,0,40,449,2,0,96.9,32.3],[969,2,2014,11,0,0,0,0,0,1,-11,0,31,475,2,0,91.4,30.5],[970,3,2012,16,0,0,0,0,0,0,0,0,53,493,9,0,158.3,70.1],[701,3,2011,16,0,0,0,0,0,0,0,0,36,409,3,0,94.9,42.0],[646,3,2013,13,0,0,0,0,0,0,0,0,32,344,1,1,70.4,31.2],[971,3,2014,10,0,0,0,0,0,0,0,0,23,258,1,0,54.8,24.3]],"DEN|2":[[375,0,2013,16,450,659,5477,55,10,32,-31,1,0,0,0,6,410.0,130],[511,0,2011,13,126,271,1729,12,6,122,660,6,0,0,0,6,199.2,50.4],[972,0,2015,8,170,275,1967,10,6,21,61,1,0,0,0,1,116.8,34.8],[512,1,2013,16,0,0,0,0,0,241,1038,10,60,548,3,0,296.6,105.2],[973,1,2014,14,0,0,0,0,0,179,849,8,34,324,2,0,211.3,77.6],[428,1,2011,15,0,0,0,0,0,249,1199,4,12,51,1,3,163.0,61.5],[974,1,2015,16,0,0,0,0,0,207,863,7,24,111,0,1,161.4,56.7],[975,1,2013,16,0,0,0,0,0,120,559,4,20,145,0,3,108.4,40.0],[976,1,2011,16,0,0,0,0,0,96,402,1,16,148,1,2,79.0,27.8],[518,2,2014,16,0,0,0,0,0,0,0,0,111,1619,11,0,340.9,113.6],[777,2,2014,16,0,0,0,0,0,8,44,0,101,1404,9,0,301.8,100.6],[858,2,2013,16,0,0,0,0,0,0,0,0,87,1288,11,1,279.8,93.3],[553,2,2013,13,0,0,0,0,0,0,0,0,73,778,10,1,208.8,69.6],[382,2,2012,14,0,0,0,0,0,0,0,0,45,544,5,0,129.4,43.1],[705,2,2013,15,0,0,0,0,0,1,7,0,16,200,3,0,54.7,18.2],[517,2,2011,12,0,0,0,0,0,7,48,0,19,155,1,0,51.3,17.1],[977,2,2011,15,0,0,0,0,0,0,0,0,18,267,1,0,50.7,16.9],[978,3,2013,14,0,0,0,0,0,0,0,0,65,788,12,0,215.8,95.5],[664,3,2012,15,0,0,0,0,0,0,0,0,52,555,2,0,119.5,52.9],[753,3,2015,16,0,0,0,0,0,0,0,0,46,517,3,0,115.7,51.2],[754,3,2012,16,0,0,0,0,0,0,0,0,41,356,5,0,106.6,47.2]],"LA|2":[[565,0,2012,16,328,551,3702,21,13,36,124,1,0,0,0,1,230.5,66.7],[979,0,2014,9,180,284,2001,12,9,16,36,0,0,0,0,3,107.6,32.3],[585,0,2014,8,145,229,1657,8,7,10,10,1,1,0,0,1,90.3,26.8],[779,0,2013,10,142,242,1673,8,7,23,64,0,0,0,0,4,85.3,22.6],[489,1,2011,15,0,0,0,0,0,260,1145,5,42,333,1,1,223.8,80.2],[980,1,2015,13,0,0,0,0,0,229,1106,10,21,188,0,1,208.4,77.6],[981,1,2013,13,0,0,0,0,0,250,973,7,26,141,1,1,183.4,62.6],[982,1,2014,12,0,0,0,0,0,179,765,4,16,148,1,1,135.3,48.1],[983,1,2014,16,0,0,0,0,0,66,246,3,45,352,1,2,124.8,42.9],[984,1,2012,16,0,0,0,0,0,98,475,0,24,163,0,2,85.8,32.3],[985,2,2015,16,0,0,0,0,0,52,434,4,52,473,5,2,198.7,66.2],[571,2,2012,15,0,0,0,0,0,0,0,0,51,691,5,0,150.1,50.0],[445,2,2011,11,0,1,0,0,0,0,0,0,51,683,5,0,149.3,49.8],[569,2,2012,11,0,0,0,0,0,2,8,0,63,666,3,2,146.4,48.8],[609,2,2014,16,0,0,0,0,0,2,14,0,48,748,3,0,142.2,47.4],[834,2,2012,15,0,0,0,0,0,3,12,0,42,698,3,0,133.0,44.3],[986,2,2013,14,0,0,0,0,0,0,0,0,38,399,4,0,101.9,34.0],[987,2,2014,13,0,0,0,0,0,1,13,0,30,435,1,0,86.8,28.9],[614,3,2013,16,0,0,0,0,0,0,0,0,51,671,5,1,146.1,64.7],[988,3,2012,16,0,0,0,0,0,0,0,0,42,519,4,0,119.9,53.1],[989,3,2013,10,0,0,0,0,0,0,0,0,13,113,2,0,36.3,16.1]],"NYG|2":[[131,0,2015,16,387,618,4432,35,14,20,61,0,0,0,0,4,287.4,88.1],[531,1,2011,12,0,0,0,0,0,171,659,9,34,267,2,1,192.6,65.9],[768,1,2015,16,0,0,0,0,0,195,863,3,29,296,1,2,164.9,59.5],[839,1,2015,16,0,0,0,0,0,61,260,0,59,495,4,0,158.5,56.0],[990,1,2014,16,0,0,0,0,0,217,721,7,18,130,0,0,145.1,45.4],[137,1,2011,14,0,0,0,0,0,152,571,7,15,128,1,0,134.9,45.3],[991,1,2012,10,0,0,0,0,0,73,385,8,12,86,0,0,109.1,41.0],[992,2,2015,15,0,0,0,0,0,1,3,0,96,1450,13,0,319.3,106.4],[993,2,2011,16,0,0,0,0,0,1,3,0,82,1536,9,1,287.9,96.0],[533,2,2011,15,0,0,0,0,0,0,0,0,76,1192,7,0,237.2,79.1],[994,2,2015,16,0,0,0,0,0,0,0,0,57,797,8,0,184.7,61.6],[534,2,2011,11,0,0,0,0,0,0,0,0,39,523,4,0,115.3,38.4],[939,2,2015,15,0,0,0,0,0,2,12,0,36,396,4,0,112.8,37.6],[535,2,2012,13,0,0,0,0,0,0,0,0,39,567,2,0,107.7,35.9],[948,2,2014,16,0,0,0,0,0,0,0,0,36,418,2,1,87.8,29.3],[995,3,2014,16,0,0,0,0,0,0,0,0,63,623,6,4,153.3,67.9],[546,3,2012,16,0,0,0,0,0,0,0,0,55,626,5,0,147.6,65.3],[996,3,2013,15,0,0,0,0,0,0,0,0,47,522,4,0,123.2,54.5],[997,3,2011,14,0,0,0,0,0,0,0,0,38,604,4,0,122.4,54.2]],"CHI|2":[[509,0,2014,15,370,561,3812,28,18,39,191,2,0,0,0,6,255.6,78.5],[167,0,2013,8,149,224,1829,13,1,13,69,1,0,0,0,1,136.1,46.8],[596,1,2013,16,0,0,0,0,0,289,1339,9,74,594,3,2,337.3,121.7],[998,1,2015,15,0,0,0,0,0,148,537,6,22,279,1,0,147.6,49.2],[8,1,2011,11,0,0,0,0,0,114,422,6,5,50,0,1,86.2,28.5],[735,1,2012,13,0,0,0,0,0,114,411,5,9,83,0,1,86.4,28.2],[999,1,2011,10,0,0,0,0,0,79,337,0,19,133,1,1,70.0,24.8],[516,2,2012,16,0,0,0,0,0,1,-2,0,118,1508,11,0,334.6,111.5],[1000,2,2013,16,0,0,0,0,0,16,105,0,89,1421,7,1,283.6,94.5],[599,2,2011,14,0,0,0,0,0,0,0,0,37,727,2,1,119.7,39.9],[158,2,2011,15,0,0,0,0,0,0,0,0,37,507,2,0,99.7,33.2],[600,2,2011,16,0,0,0,0,0,1,-6,0,26,369,1,0,86.3,28.8],[601,2,2013,14,0,0,0,0,0,0,0,0,32,243,4,0,82.3,27.4],[1001,2,2015,11,0,0,0,0,0,0,0,0,28,464,1,0,80.4,26.8],[1002,2,2011,14,0,0,0,0,0,1,-4,0,27,276,3,0,72.2,24.1],[546,3,2014,16,0,0,0,0,0,0,0,0,90,916,6,0,221.6,98.1],[772,3,2015,13,0,0,0,0,0,0,0,0,34,439,5,0,107.9,47.8],[1003,3,2011,15,0,0,0,0,0,0,0,0,18,206,5,0,68.6,30.4]],"CLE|2":[[1004,0,2012,15,297,517,3385,14,17,27,111,0,0,-9,0,1,165.6,43.7],[668,0,2011,13,265,463,2733,14,11,61,212,0,1,-5,0,2,161.0,42.8],[167,0,2015,8,186,292,2109,12,4,20,98,1,0,0,0,6,132.2,42.0],[952,0,2014,14,242,438,3326,12,13,24,39,0,0,0,0,1,156.9,41.3],[891,1,2012,15,0,0,0,0,0,267,950,11,51,367,1,0,254.7,85.5],[1005,1,2015,16,0,0,0,0,0,104,379,0,61,534,2,0,164.3,56.0],[1006,1,2015,16,0,0,0,0,0,185,706,4,19,182,1,0,137.8,46.2],[1007,1,2013,16,0,0,0,0,0,49,240,0,48,343,2,2,114.3,41.4],[1008,1,2014,14,0,0,0,0,0,171,673,4,11,64,1,1,112.7,38.2],[515,1,2011,10,0,0,0,0,0,161,587,3,22,130,0,1,109.7,35.7],[1009,2,2013,14,0,0,0,0,0,5,88,0,87,1646,9,0,314.4,104.8],[1010,2,2015,16,0,0,0,0,0,4,12,0,68,966,5,2,197.8,65.9],[1011,2,2014,15,0,0,0,0,0,3,15,0,63,824,2,0,158.9,53.0],[1012,2,2011,16,0,0,0,0,0,3,15,0,61,709,2,0,145.4,48.5],[673,2,2011,16,0,0,0,0,0,7,25,0,41,518,4,0,125.3,41.8],[542,2,2014,12,0,0,0,0,0,0,0,0,47,568,2,0,115.8,38.6],[555,2,2015,12,0,0,0,0,0,0,0,0,46,523,2,0,110.3,36.8],[1013,2,2014,16,0,0,0,0,0,4,10,0,36,621,1,0,105.1,35.0],[623,3,2015,16,0,0,0,0,0,0,0,0,79,1043,9,0,237.3,105.0],[1014,3,2013,15,0,0,0,0,0,0,0,0,80,917,7,0,213.7,94.6],[79,3,2012,16,0,0,0,0,0,0,0,0,49,501,3,0,117.1,51.8],[676,3,2011,15,0,0,0,0,0,0,0,0,34,324,4,0,90.4,40.0]],"SF|2":[[1015,0,2013,16,243,416,3197,21,8,92,524,4,0,0,0,4,264.3,79.0],[785,0,2011,16,273,445,3144,17,5,52,179,2,0,0,0,2,211.7,64.1],[1016,0,2015,8,178,282,2031,10,7,32,185,1,0,0,0,1,129.7,39.1],[440,1,2012,16,0,0,0,0,0,258,1214,8,28,234,1,1,224.8,82.5],[1017,1,2011,16,0,0,0,0,0,112,473,2,16,195,0,0,94.8,33.5],[1018,1,2015,7,0,0,0,0,0,115,470,3,11,53,0,0,81.3,28.2],[850,1,2015,6,0,0,0,0,0,76,263,1,25,175,0,0,74.8,24.5],[1019,1,2013,13,0,0,0,0,0,7,13,0,25,243,0,0,50.6,17.3],[789,2,2012,16,0,0,0,0,0,1,8,0,85,1105,9,0,250.3,83.4],[174,2,2013,16,0,0,0,0,0,2,11,0,85,1179,7,0,246.0,82.0],[830,2,2015,16,0,0,0,0,0,0,0,0,33,663,4,0,125.3,41.8],[534,2,2012,12,0,0,0,0,0,3,64,0,42,449,1,1,97.3,32.4],[759,2,2014,13,0,0,0,0,0,0,0,0,35,435,3,0,96.5,32.2],[277,2,2012,16,0,0,0,0,0,0,0,0,28,434,3,0,89.4,29.8],[1020,2,2015,16,0,0,0,0,0,1,5,0,30,394,1,0,75.9,25.3],[1021,2,2011,12,0,0,0,0,0,2,32,0,20,241,3,0,65.3,21.8],[792,3,2013,15,0,0,0,0,0,0,0,0,52,850,13,1,213.0,94.3],[1022,3,2015,14,0,0,0,0,0,0,0,0,30,326,3,0,80.6,35.7],[793,3,2012,16,0,0,0,0,0,0,0,0,21,344,3,1,71.4,31.6],[1023,3,2015,10,0,0,0,0,0,0,0,0,19,186,3,0,55.6,24.6]],"CIN|2":[[1024,0,2013,16,363,586,4293,33,20,61,183,2,0,0,0,3,288.0,86.7],[1025,1,2014,16,0,0,0,0,0,222,1124,9,27,215,0,2,210.9,80.0],[1026,1,2013,16,0,0,0,0,0,170,695,5,56,514,3,1,222.9,77.9],[559,1,2012,15,0,0,0,0,0,278,1094,6,22,104,0,2,173.8,59.5],[597,1,2011,15,0,0,0,0,0,273,1067,6,15,82,0,2,161.9,55.1],[703,1,2011,16,0,1,0,0,0,112,380,3,13,38,0,0,72.8,22.7],[1027,1,2012,11,0,0,0,0,0,36,258,1,9,85,0,0,49.3,20.9],[1028,2,2013,16,0,0,0,0,0,0,0,0,98,1426,11,0,306.6,102.2],[1029,2,2013,16,0,0,0,0,0,8,65,0,51,712,10,0,188.7,62.9],[1030,2,2014,16,3,3,79,1,0,7,51,0,56,790,5,0,179.3,59.8],[706,2,2011,16,0,0,0,0,0,0,0,0,50,725,4,0,146.5,48.8],[1011,2,2012,14,0,0,0,0,0,6,30,0,51,533,4,0,131.3,43.8],[705,2,2011,12,0,0,0,0,0,0,0,0,37,317,3,0,86.7,28.9],[1031,3,2015,13,0,0,0,0,0,0,0,0,52,615,13,0,191.5,84.8],[707,3,2012,16,0,0,0,0,0,0,0,0,64,737,5,1,165.7,73.4]],"SEA|2":[[1032,0,2015,16,329,483,4024,34,8,103,553,1,0,0,0,3,336.3,109.6],[695,0,2011,15,271,450,3091,14,13,40,108,1,0,0,0,4,162.4,45.7],[642,1,2014,16,0,0,0,0,0,280,1306,13,37,367,4,2,302.3,109.5],[1033,1,2015,12,0,0,0,0,0,147,830,4,9,76,1,1,127.6,51.9],[757,1,2015,15,0,0,0,0,0,26,100,0,32,257,2,1,77.7,27.1],[1034,1,2014,16,0,0,0,0,0,74,310,0,16,186,2,1,75.6,26.6],[641,1,2011,16,0,0,0,0,0,46,145,1,23,128,0,0,56.3,18.3],[1035,2,2015,16,0,0,0,0,0,0,0,0,78,1069,14,0,268.9,89.6],[920,2,2013,16,0,0,0,0,0,3,31,0,64,898,5,0,186.9,62.3],[698,2,2012,16,1,2,25,0,0,2,6,0,50,748,7,0,168.4,56.1],[1036,2,2015,16,0,0,0,0,0,5,20,0,51,664,6,1,165.4,55.1],[1037,2,2015,16,0,0,0,0,0,0,0,0,49,685,5,0,147.5,49.2],[645,2,2011,16,0,0,0,0,0,1,13,0,37,436,2,0,93.9,31.3],[1038,2,2014,12,0,0,0,0,0,0,0,0,29,271,1,0,62.1,20.7],[699,2,2014,5,0,0,0,0,0,11,92,1,22,133,0,0,50.5,16.8],[685,3,2015,11,0,0,0,0,0,0,0,0,48,605,2,0,120.5,53.3],[742,3,2013,13,0,0,0,0,0,0,0,0,33,387,5,0,101.7,45.0],[1039,3,2014,13,0,0,0,0,0,0,0,0,22,362,3,0,76.2,33.7],[1040,3,2012,14,0,0,0,0,0,0,0,0,18,291,3,0,65.1,28.8]],"LV|2":[[1041,0,2015,16,350,573,3987,32,13,33,138,0,0,0,0,3,271.3,82.0],[222,0,2012,15,345,565,4018,22,14,18,36,1,0,0,0,5,224.3,66.3],[576,0,2011,6,100,165,1170,6,4,18,60,2,0,0,0,1,78.8,22.9],[1042,0,2013,7,118,211,1547,8,8,11,27,0,0,0,0,1,78.6,19.7],[735,1,2011,16,0,0,0,0,0,256,977,7,37,418,1,1,222.5,75.9],[1043,1,2015,16,0,0,0,0,0,266,1066,6,41,232,0,1,204.8,70.9],[768,1,2013,15,0,0,0,0,0,163,733,6,36,292,0,0,174.5,63.1],[736,1,2012,15,0,0,0,0,0,59,271,0,52,496,1,0,134.7,48.2],[733,1,2011,7,0,0,0,0,0,113,614,4,19,154,1,1,123.8,48.2],[617,1,2012,12,0,0,0,0,0,35,221,0,16,195,1,0,63.6,24.8],[789,2,2015,16,0,0,0,0,0,0,0,0,85,922,9,0,231.2,77.1],[1044,2,2015,16,0,0,0,0,0,3,-3,0,72,1070,6,1,212.7,70.9],[741,2,2011,15,0,0,0,0,0,0,0,0,64,975,4,1,183.5,61.2],[630,2,2014,16,0,0,0,0,0,0,0,0,73,666,6,1,173.6,57.9],[1045,2,2013,16,0,0,0,0,0,2,17,0,60,888,4,1,172.5,57.5],[1046,2,2012,15,0,0,0,0,0,1,-5,0,51,741,7,0,166.6,55.5],[1047,2,2013,11,156,272,1798,7,11,83,576,2,0,0,0,2,143.5,47.8],[1048,2,2014,16,0,0,0,0,0,0,0,0,47,693,4,0,140.3,46.8],[996,3,2012,16,0,0,0,0,0,0,0,0,79,806,4,0,183.6,81.3],[1049,3,2014,16,0,0,0,0,0,0,0,0,58,534,4,1,133.4,59.1],[537,3,2011,12,0,0,0,0,0,0,0,0,28,368,3,0,82.8,36.7],[1050,3,2015,15,0,0,0,0,0,0,0,0,28,329,3,0,78.9,34.9]],"BUF|2":[[1051,0,2015,14,242,380,3035,20,6,104,568,4,1,4,0,1,271.6,85.5],[702,0,2011,16,353,569,3832,24,23,56,215,0,0,0,0,2,222.8,64.4],[510,0,2014,12,287,447,3018,18,10,15,14,1,0,0,0,3,176.1,53.8],[1052,0,2013,10,180,306,1972,11,9,53,186,2,0,0,0,3,133.5,36.1],[758,1,2012,16,0,0,0,0,0,207,1244,6,43,459,2,3,255.3,101.8],[757,1,2013,16,0,0,0,0,0,206,890,9,47,387,1,0,234.7,83.5],[726,1,2015,12,0,0,0,0,0,203,895,3,32,292,2,2,178.7,64.3],[1053,1,2015,11,0,0,0,0,0,93,517,7,11,96,2,1,124.3,47.9],[1054,1,2014,14,0,0,0,0,0,105,432,2,8,49,0,0,68.1,23.7],[1055,1,2015,5,0,0,0,0,0,47,267,3,6,29,0,1,51.6,20.5],[1056,2,2015,13,0,0,0,0,0,1,1,0,60,1047,9,0,218.8,72.9],[759,2,2011,16,0,0,0,0,0,0,0,0,76,1004,7,0,218.4,72.8],[1057,2,2014,16,0,0,0,0,0,0,0,0,65,699,5,1,164.9,55.0],[761,2,2011,16,0,0,0,0,0,0,0,0,61,658,5,0,156.8,52.3],[762,2,2012,12,0,0,0,0,0,0,0,0,41,443,4,0,109.3,36.4],[1058,2,2014,16,0,0,0,0,0,0,0,0,41,426,4,2,103.6,34.5],[1059,2,2013,16,0,0,0,0,0,4,14,0,23,361,2,1,70.5,23.5],[783,2,2011,15,0,1,0,0,1,20,87,1,23,240,1,0,65.7,21.9],[845,3,2012,15,0,0,0,0,0,0,0,0,43,571,6,1,134.1,59.4],[1060,3,2015,13,0,0,0,0,0,0,0,0,51,528,3,0,121.8,53.9]],"JAX|2":[[1061,0,2015,16,355,606,4428,35,18,52,310,2,0,0,0,5,316.1,93.6],[547,0,2013,15,305,503,3241,13,14,27,77,0,0,0,0,0,161.3,44.8],[1016,0,2011,15,210,413,2214,12,11,48,98,0,0,0,0,4,116.4,24.3],[767,1,2011,16,0,0,0,0,0,343,1606,8,43,374,3,1,305.0,110.6],[1062,1,2015,12,0,0,0,0,0,182,740,2,36,279,1,0,155.9,54.1],[1063,1,2014,13,0,1,0,0,0,135,582,4,23,124,0,2,113.6,40.5],[1064,1,2014,16,0,0,0,0,0,32,186,1,25,198,1,0,75.4,28.3],[697,1,2014,14,0,0,0,0,0,101,326,2,20,186,0,1,81.2,25.4],[768,1,2012,10,0,0,0,0,0,101,283,2,19,130,0,1,72.3,20.8],[1065,2,2015,16,0,0,0,0,0,0,0,0,80,1400,14,0,304.0,101.3],[1066,2,2015,15,0,0,0,0,0,0,0,0,64,1031,10,1,225.1,75.0],[958,2,2012,14,0,0,0,0,0,1,-4,0,55,979,7,1,192.5,64.2],[1067,2,2012,16,0,0,0,0,0,2,23,0,64,865,5,0,184.8,61.6],[1068,2,2013,15,1,1,21,1,0,2,4,0,51,484,1,0,110.6,36.9],[770,2,2011,15,0,0,0,0,0,3,11,0,44,415,1,0,92.6,30.9],[1069,2,2013,11,0,0,0,0,0,0,0,0,32,446,2,1,86.6,28.9],[1070,2,2014,12,0,0,0,0,0,3,9,0,37,422,1,0,86.1,28.7],[771,3,2012,15,0,0,0,0,0,0,0,0,52,540,4,0,130.0,57.5],[978,3,2015,12,0,0,0,0,0,0,0,0,46,455,5,0,121.5,53.8],[872,3,2013,14,0,0,0,0,0,0,0,0,24,292,2,1,63.2,28.0]],"MIA|2":[[1071,0,2014,16,392,590,4045,27,12,56,311,1,1,-4,0,2,279.5,87.0],[1072,0,2011,13,210,347,2497,16,9,32,65,2,0,0,0,1,162.4,48.1],[1073,1,2014,16,0,0,0,0,0,216,1099,8,38,275,1,3,223.4,84.5],[677,1,2011,15,0,0,0,0,0,216,1086,6,43,296,1,2,219.2,82.7],[1074,1,2013,15,0,0,0,0,0,109,406,4,15,63,2,0,97.9,32.8],[1075,1,2014,15,0,0,0,0,0,36,122,0,21,187,1,0,57.9,19.4],[1076,2,2015,16,1,1,9,0,0,18,113,1,110,1157,4,0,275.4,91.8],[516,2,2011,16,0,0,0,0,0,1,13,0,81,1214,6,1,237.7,79.2],[775,2,2014,16,0,1,0,0,0,4,16,0,67,862,10,1,212.8,70.9],[555,2,2013,16,0,0,0,0,0,0,0,0,76,1016,4,0,201.6,67.2],[551,2,2012,13,0,0,0,0,0,0,0,0,61,778,1,0,144.8,48.3],[1077,2,2015,11,0,0,0,0,0,1,4,0,43,662,4,0,133.6,44.5],[1078,2,2015,10,0,0,0,0,0,0,0,0,26,494,3,0,93.4,31.1],[912,2,2015,15,0,0,0,0,0,0,0,0,27,440,3,0,89.0,29.7],[1060,3,2013,16,0,0,0,0,0,7,15,1,69,759,6,0,188.4,83.4],[556,3,2011,15,0,0,0,0,0,0,0,0,32,451,5,0,107.1,47.4],[1014,3,2015,16,0,0,0,0,0,0,0,0,35,386,3,0,91.6,40.5],[1079,3,2014,14,0,0,0,0,0,0,0,0,24,284,2,0,64.4,28.5]],"BAL|3":[[1080,0,2019,15,265,401,3127,36,6,176,1206,7,0,0,0,2,415.7,130],[709,0,2016,16,436,672,4317,20,15,21,58,2,0,0,0,3,242.5,70.3],[908,1,2019,15,0,0,0,0,0,202,1018,10,26,247,5,2,242.5,84.4],[1081,1,2020,15,0,0,0,0,0,134,805,9,18,120,0,0,168.5,62.6],[1082,1,2017,15,0,0,0,0,0,212,973,6,23,187,0,2,171.0,58.1],[1008,1,2016,16,0,0,0,0,0,193,774,5,34,236,1,0,171.0,54.5],[827,1,2017,16,0,0,0,0,0,153,591,4,46,250,2,0,166.1,52.5],[1083,1,2020,16,0,0,0,0,0,144,723,6,9,129,0,1,128.2,45.4],[775,2,2016,16,0,0,0,0,0,5,31,0,72,1017,4,0,202.8,72.0],[211,2,2016,14,0,0,0,0,0,0,0,0,70,799,5,0,183.9,65.3],[1084,2,2020,16,0,0,0,0,0,1,1,0,58,769,8,0,183.0,65.0],[902,2,2018,16,0,0,0,0,0,3,4,0,42,715,5,0,143.9,51.1],[911,2,2018,15,0,0,0,0,0,1,13,0,62,651,1,0,134.4,47.7],[789,2,2018,16,0,0,0,0,0,0,0,0,54,607,3,0,132.7,47.1],[728,2,2017,12,0,0,0,0,0,0,0,0,40,440,3,0,102.0,36.2],[1085,2,2016,15,0,0,0,0,0,1,2,0,33,499,3,0,101.1,35.9],[1086,3,2019,15,0,0,0,0,0,0,0,0,64,852,10,1,207.2,97.2],[835,3,2016,16,0,0,0,0,0,0,0,0,86,729,2,1,168.9,79.2],[79,3,2017,16,0,0,0,0,0,0,0,0,61,522,4,0,137.2,64.4],[1087,3,2019,16,0,0,0,0,0,0,0,0,30,349,2,0,76.9,36.1]],"NO|3":[[473,0,2016,16,471,673,5208,37,15,23,20,2,0,0,0,4,332.3,104.4],[962,0,2019,9,133,196,1384,9,2,28,31,0,0,0,0,0,90.5,29.4],[1088,1,2020,15,0,0,0,0,0,187,932,16,83,756,5,0,377.8,128.2],[908,1,2017,16,0,0,0,0,0,230,1124,12,58,416,0,3,278.0,95.1],[1043,1,2019,16,0,0,0,0,0,146,637,5,34,235,1,0,157.2,52.0],[687,1,2016,16,0,0,0,0,0,133,548,4,22,200,1,0,126.8,41.0],[909,1,2016,15,0,0,0,0,0,4,19,0,40,281,4,0,94.0,30.9],[627,1,2016,13,0,0,0,0,0,18,37,4,16,70,1,0,56.7,17.4],[1089,2,2019,16,0,0,0,0,0,1,-9,0,149,1725,9,0,374.6,130],[910,2,2016,15,0,0,0,0,0,6,30,0,78,1173,8,0,246.3,87.5],[911,2,2016,15,1,1,50,1,0,0,0,0,72,895,4,0,191.5,68.0],[777,2,2020,14,0,0,0,0,0,1,12,0,61,726,5,0,164.8,58.5],[552,2,2017,15,0,0,0,0,0,10,39,0,53,787,4,0,159.6,56.7],[1090,2,2020,13,0,0,0,0,0,1,3,0,34,448,4,0,103.1,36.6],[913,2,2017,15,0,0,0,0,0,0,0,0,23,364,3,2,73.4,26.1],[1091,2,2020,9,0,0,0,0,0,6,51,0,20,186,1,0,49.7,17.7],[614,3,2019,14,0,0,0,0,0,0,0,0,43,705,9,0,167.5,78.6],[1092,3,2020,16,88,121,928,4,2,87,457,8,8,98,1,5,156.6,73.5],[895,3,2016,16,0,0,0,0,0,1,2,1,50,631,3,0,137.3,64.4],[79,3,2018,13,0,0,0,0,0,0,0,0,35,400,2,0,87.0,40.8]],"ARI|3":[[1093,0,2020,16,375,558,3971,26,12,133,819,11,0,0,0,4,378.7,115.0],[222,0,2016,15,364,597,4233,26,14,14,38,0,0,0,0,4,243.1,69.9],[1094,0,2018,14,217,393,2278,11,14,23,138,0,0,0,0,5,112.9,23.0],[900,1,2016,16,0,0,0,0,0,293,1239,16,80,879,4,3,407.8,130],[1095,1,2020,15,0,0,0,0,0,239,955,10,25,137,0,1,192.2,61.3],[1096,1,2020,16,0,0,0,0,0,97,448,1,53,402,4,0,168.0,56.2],[901,1,2017,8,0,0,0,0,0,15,53,1,33,297,0,0,74.0,24.0],[1097,1,2017,16,0,0,0,0,0,120,426,1,10,93,0,0,67.9,19.5],[696,1,2017,6,0,0,0,0,0,129,448,2,9,66,0,2,68.4,19.2],[957,2,2020,16,0,0,0,0,0,1,1,0,115,1407,6,2,287.8,102.2],[172,2,2017,16,1,1,21,0,0,0,0,0,109,1156,6,1,261.4,92.9],[1098,2,2019,13,0,0,0,0,0,10,93,0,68,709,3,0,168.2,59.7],[905,2,2016,14,0,0,0,0,0,4,83,1,34,568,6,1,139.1,49.4],[902,2,2016,15,0,0,0,0,0,1,10,0,39,517,2,0,103.7,36.8],[904,2,2017,16,0,0,0,0,0,0,0,0,31,477,4,0,102.7,36.5],[903,2,2016,12,0,0,0,0,0,0,0,0,33,446,4,0,101.6,36.1],[1099,2,2019,11,0,0,0,0,0,0,0,0,32,359,1,1,71.9,25.5],[1100,3,2020,15,0,0,0,0,0,0,0,0,31,438,4,1,96.8,45.4],[707,3,2016,16,0,0,0,0,0,0,0,0,37,391,2,0,88.1,41.3],[1101,3,2018,15,0,0,0,0,0,0,0,0,34,343,1,0,74.3,34.8],[1060,3,2019,15,0,0,0,0,0,0,0,0,18,237,1,0,47.7,22.4]],"LAC|3":[[1102,0,2020,15,396,595,4336,31,10,55,234,5,0,0,0,1,332.8,102.1],[717,0,2018,16,347,508,4308,32,12,18,7,0,0,0,0,1,285.0,90.7],[1103,1,2019,16,0,0,0,0,0,132,557,3,92,993,8,2,309.0,101.3],[928,1,2018,12,0,0,0,0,0,175,885,10,50,490,4,0,275.5,94.8],[1104,1,2020,13,0,0,0,0,0,111,354,2,23,148,0,2,81.2,22.8],[1105,1,2020,8,0,0,0,0,0,88,290,3,20,99,0,0,76.9,22.5],[1106,1,2020,8,0,0,0,0,0,59,270,0,19,173,0,0,65.3,22.0],[929,2,2017,16,0,0,0,0,0,2,9,0,102,1393,6,0,278.2,98.8],[1107,2,2016,16,0,0,0,0,0,0,0,0,69,1059,7,0,216.9,77.0],[1108,2,2018,16,0,0,0,0,0,7,28,1,43,664,10,0,180.2,64.0],[931,2,2016,16,0,0,0,0,0,0,0,0,58,810,4,0,163.0,57.9],[1010,2,2016,14,0,1,0,0,0,2,-3,0,47,677,4,3,132.4,47.0],[1109,2,2020,16,0,0,0,0,0,2,0,0,28,511,3,0,97.1,34.5],[1110,2,2020,11,0,0,0,0,0,3,17,0,20,398,3,0,79.5,28.2],[1111,3,2019,12,0,0,0,0,0,0,0,0,55,652,5,1,150.2,70.4],[486,3,2016,13,0,0,0,0,0,0,0,0,53,548,7,1,147.8,69.3],[1112,3,2018,14,0,0,0,0,0,0,0,0,19,210,1,0,46.0,21.6],[1113,3,2020,11,0,0,0,0,0,0,0,0,10,159,3,0,43.9,20.6]],"DET|3":[[586,0,2017,16,371,565,4446,29,10,29,98,0,0,0,0,7,273.6,84.4],[1114,1,2020,13,0,0,0,0,0,114,521,8,46,357,2,2,189.8,63.4],[917,1,2016,10,0,0,0,0,0,92,357,1,53,371,5,0,161.8,52.0],[1115,1,2018,10,0,0,0,0,0,118,641,3,32,213,1,1,139.4,50.1],[696,1,2020,16,0,0,0,0,0,156,604,7,12,101,0,0,124.5,38.9],[919,1,2017,14,0,0,0,0,0,165,552,4,25,162,1,1,124.4,36.0],[1116,1,2016,11,0,0,0,0,0,88,334,4,18,196,0,1,93.0,29.2],[1117,2,2019,16,0,0,0,0,0,0,0,0,65,1190,11,1,248.0,88.1],[1029,2,2020,16,0,0,0,0,0,0,0,0,76,978,9,0,227.8,80.9],[920,2,2017,16,0,0,0,0,0,5,22,0,92,1003,5,1,224.5,79.7],[174,2,2016,16,0,0,0,0,0,0,0,0,67,584,8,0,173.4,61.6],[569,2,2019,15,1,1,19,1,0,0,0,0,62,678,1,0,140.6,49.9],[1118,2,2017,13,0,0,0,0,0,0,0,0,30,399,1,0,77.9,27.7],[1119,2,2020,12,0,0,0,0,0,0,0,0,20,349,2,0,66.9,23.8],[1120,2,2020,10,0,0,0,0,0,1,1,0,17,290,2,0,58.1,20.6],[1121,3,2020,16,0,0,0,0,0,1,0,0,67,723,6,1,175.3,82.2],[925,3,2016,13,0,0,0,0,0,1,1,1,61,711,1,0,144.2,67.6],[810,3,2018,11,0,0,0,0,0,0,0,0,21,263,1,0,53.3,25.0],[907,3,2017,14,0,0,0,0,0,0,0,0,17,177,3,0,52.7,24.7]],"DAL|3":[[1122,0,2019,16,388,596,4902,30,11,52,277,3,0,0,0,2,337.8,103.4],[1024,0,2020,11,216,333,2170,14,8,28,114,0,1,-3,0,1,136.9,39.9],[1123,1,2016,15,0,0,0,0,0,322,1631,15,32,363,1,1,325.4,111.8],[1124,1,2020,16,0,0,0,0,0,101,435,4,28,193,1,0,120.8,39.8],[1125,1,2017,13,0,0,0,0,0,55,232,4,19,202,1,0,92.4,30.2],[879,1,2017,13,0,0,0,0,0,115,547,1,7,45,0,0,72.2,25.4],[1044,2,2019,16,0,0,0,0,0,1,6,0,79,1189,8,0,246.5,87.6],[1126,2,2020,16,0,0,0,0,0,10,82,1,74,935,5,1,217.7,77.3],[1127,2,2019,14,0,0,0,0,0,0,0,0,66,1107,6,0,212.7,75.6],[937,2,2016,16,0,1,0,0,0,1,7,0,75,833,5,0,189.0,67.1],[544,2,2017,16,0,0,0,0,0,1,-4,0,69,838,6,1,186.4,66.2],[797,2,2019,15,0,1,0,0,0,3,11,0,55,828,3,1,154.9,55.0],[936,2,2016,15,0,0,0,0,0,0,0,0,44,594,4,1,125.4,44.5],[1128,2,2017,13,0,0,0,0,0,0,0,0,15,317,3,0,64.7,23.0],[18,3,2016,15,0,0,0,0,0,0,0,0,69,673,3,1,152.3,71.4],[1129,3,2020,16,0,0,0,0,0,0,0,0,63,615,4,1,146.5,68.7],[1130,3,2019,15,0,0,0,0,0,0,0,0,31,365,3,0,85.5,40.1],[1131,3,2018,9,0,0,0,0,0,0,0,0,26,242,1,0,56.2,26.4]],"NYG|3":[[131,0,2018,16,380,576,4299,21,11,15,20,1,0,0,0,4,240.0,72.5],[1132,0,2019,13,284,459,3027,24,12,45,279,2,0,0,0,11,215.0,62.1],[1133,1,2018,16,0,0,0,0,0,261,1307,11,91,721,4,0,385.8,130],[1134,1,2020,14,0,0,0,0,0,147,682,6,21,114,0,0,136.6,46.5],[1135,1,2017,15,0,0,0,0,0,171,751,5,19,116,0,0,137.7,45.8],[768,1,2016,13,0,0,0,0,0,181,593,3,35,201,1,0,138.4,39.7],[839,1,2017,16,0,1,0,0,1,45,164,0,44,253,0,0,83.7,26.6],[1136,1,2016,14,0,0,0,0,0,112,456,0,15,162,0,0,76.8,24.5],[992,2,2016,16,0,0,0,0,0,1,9,0,101,1367,10,1,296.6,105.4],[1137,2,2016,16,0,0,0,0,0,3,31,0,65,683,8,0,184.4,65.5],[1138,2,2019,14,0,0,0,0,0,0,0,0,48,740,8,0,170.0,60.4],[920,2,2019,11,0,0,0,0,0,1,16,0,49,676,6,1,152.2,54.1],[993,2,2016,14,0,0,0,0,0,0,0,0,39,586,1,1,101.6,36.1],[1139,2,2017,15,0,0,0,0,0,0,0,0,36,416,2,0,89.6,31.8],[1140,2,2019,14,0,0,0,0,0,0,0,0,24,300,2,0,66.0,23.4],[1141,2,2017,8,0,0,0,0,0,2,3,0,18,240,3,0,60.3,21.4],[1142,3,2017,15,0,0,0,0,0,1,14,0,64,722,6,0,173.6,81.4],[1143,3,2016,16,0,0,0,0,0,0,0,0,48,395,1,0,93.5,43.9],[1144,3,2019,7,0,0,0,0,0,0,0,0,31,268,3,0,75.8,35.6],[1145,3,2018,13,0,0,0,0,0,0,0,0,25,272,1,0,60.2,28.2]],"PIT|3":[[185,0,2018,16,452,675,5129,34,16,31,98,3,1,-1,0,2,341.9,104.5],[1146,0,2019,10,176,283,1765,13,9,21,42,0,0,0,0,0,108.8,29.1],[822,1,2017,15,0,0,0,0,0,321,1291,9,85,655,2,2,341.6,110.6],[1147,1,2018,13,0,0,0,0,0,215,973,12,55,497,1,2,280.0,93.5],[1148,1,2019,13,4,5,35,0,1,66,175,1,47,305,1,1,104.4,30.9],[615,1,2016,8,0,0,0,0,0,98,343,4,18,118,2,0,100.1,30.5],[1149,1,2020,15,0,0,0,0,0,111,368,4,10,61,0,1,74.9,21.2],[824,2,2018,15,0,1,0,0,0,0,0,0,104,1297,15,0,323.7,115.0],[1150,2,2018,16,0,0,0,0,0,1,13,0,111,1426,7,1,296.9,105.5],[1151,2,2020,15,0,0,0,0,0,3,15,0,88,923,7,1,221.8,78.8],[1152,2,2020,16,0,0,0,0,0,10,16,2,62,873,9,1,214.9,76.3],[1153,2,2019,15,0,0,0,0,0,0,0,0,44,735,3,1,133.5,47.4],[825,2,2017,15,0,0,0,0,0,6,22,0,50,603,3,0,132.5,47.1],[1154,2,2016,13,0,0,0,0,0,1,6,0,48,594,3,0,126.0,44.8],[1155,2,2016,14,0,0,0,0,0,4,14,0,21,435,2,0,77.9,27.7],[925,3,2020,15,0,0,0,0,0,0,0,0,56,558,5,1,141.8,66.5],[1022,3,2018,15,0,0,0,0,0,0,0,0,50,610,4,1,133.0,62.4],[1156,3,2017,14,0,0,0,0,0,0,0,0,43,372,3,0,98.2,46.1],[933,3,2016,6,0,0,0,0,0,0,0,0,18,304,1,0,54.4,25.5]],"KC|3":[[1157,0,2018,16,383,580,5097,50,12,60,272,2,0,0,0,2,417.1,130],[785,0,2017,15,341,505,4042,26,5,60,355,1,0,0,0,1,295.2,93.1],[1158,1,2017,16,0,0,0,0,0,272,1327,8,53,455,3,1,295.2,100.7],[848,1,2016,14,0,0,0,0,0,214,921,3,33,447,2,3,193.8,63.8],[1159,1,2020,13,0,0,0,0,0,181,803,4,36,297,1,0,176.0,58.7],[1075,1,2019,11,0,0,0,0,0,111,498,5,30,213,2,1,141.1,47.1],[726,1,2019,13,0,0,0,0,0,101,465,4,28,181,1,2,118.6,40.0],[846,1,2016,15,0,0,0,0,0,88,293,1,28,188,2,0,94.1,28.3],[1160,2,2018,16,0,0,0,0,0,22,151,1,87,1479,12,0,334.0,118.6],[1056,2,2019,13,0,0,0,0,0,2,12,0,52,673,3,1,138.5,49.2],[1161,2,2020,16,0,0,0,0,0,4,31,0,41,560,4,2,128.1,45.5],[851,2,2017,13,0,0,0,0,0,3,6,0,42,554,3,0,116.0,41.2],[728,2,2016,12,0,1,0,0,0,1,-1,0,44,536,2,0,109.5,38.9],[1162,2,2020,15,0,0,0,0,0,0,0,0,45,466,3,1,107.6,38.2],[1163,2,2016,16,0,0,0,0,0,0,0,0,44,530,0,0,97.0,34.5],[854,3,2020,15,1,2,4,0,0,0,0,0,105,1416,11,1,312.8,130],[1164,3,2017,13,0,0,0,0,0,0,0,0,18,224,1,0,46.4,21.8]],"GB|3":[[624,0,2020,16,372,526,4299,48,5,38,149,3,1,-6,0,2,383.3,125.5],[1165,0,2017,11,192,316,1836,9,12,36,270,2,1,10,0,2,124.4,29.8],[1166,1,2019,16,0,0,0,0,0,236,1084,16,49,474,3,2,314.8,105.4],[1167,1,2019,14,0,0,0,0,0,107,460,1,39,253,5,0,146.3,48.1],[1168,1,2016,10,0,0,0,0,0,34,150,2,9,46,1,0,46.6,15.4],[795,1,2016,9,0,0,0,0,0,63,145,0,19,134,2,0,58.9,15.4],[799,2,2020,14,0,0,0,0,0,0,0,0,115,1374,18,1,358.4,127.3],[631,2,2016,16,0,0,0,0,0,0,0,0,97,1257,14,1,304.7,108.2],[797,2,2017,14,1,1,10,0,0,9,17,0,66,653,4,0,159.4,56.6],[1169,2,2016,15,0,0,0,0,0,77,457,3,44,348,0,1,140.5,49.9],[1170,2,2020,14,0,0,0,0,0,4,13,0,33,690,6,1,137.3,48.8],[1171,2,2019,12,0,0,0,0,0,1,21,0,35,477,3,0,102.8,36.5],[1172,2,2019,15,0,0,0,0,0,1,7,0,34,287,2,1,75.4,26.8],[1173,2,2018,11,0,0,0,0,0,1,5,0,21,328,0,0,54.3,19.3],[1174,3,2020,15,0,0,0,0,0,0,0,0,52,586,11,0,176.6,82.8],[685,3,2018,16,0,0,0,0,0,0,0,0,55,636,2,0,130.6,61.3],[614,3,2016,10,0,0,0,0,0,0,0,0,30,377,1,1,71.7,33.6],[800,3,2016,15,0,0,0,0,0,0,0,0,30,271,2,0,69.1,32.4]],"IND|3":[[888,0,2018,16,430,639,4593,39,15,46,148,0,1,4,0,1,327.9,101.1],[717,0,2020,16,369,543,4169,24,11,18,-8,0,0,0,0,1,240.0,74.7],[1175,0,2019,15,272,447,2942,18,6,56,228,4,1,2,0,5,217.7,62.6],[1176,1,2020,15,0,0,0,0,0,232,1169,11,36,299,1,1,252.8,87.8],[440,1,2016,16,0,0,0,0,0,263,1025,4,38,277,4,1,214.2,67.9],[1177,1,2020,16,0,0,0,0,0,89,380,3,63,482,4,0,193.2,63.4],[1178,1,2018,12,0,0,0,0,0,195,908,9,17,103,1,2,178.1,60.8],[1034,1,2016,15,0,0,0,0,0,47,164,7,26,179,1,0,108.3,34.4],[1179,1,2018,13,0,0,0,0,0,60,336,1,16,85,0,2,60.1,22.2],[893,2,2016,16,0,0,0,0,0,0,0,0,91,1448,6,0,273.8,97.3],[1180,2,2020,16,0,1,0,0,0,0,0,0,44,629,5,0,136.9,48.6],[1181,2,2018,16,0,0,0,0,0,1,-4,0,53,485,2,0,117.1,41.6],[894,2,2016,9,0,0,0,0,0,1,-1,0,30,307,7,0,102.6,36.4],[1182,2,2020,13,0,0,0,0,0,3,26,0,40,503,1,0,98.9,35.1],[1183,2,2016,15,0,0,0,0,0,2,10,0,33,528,2,0,98.8,35.1],[931,2,2018,8,0,0,0,0,0,0,0,0,28,304,3,0,76.4,27.1],[1184,2,2018,14,0,0,0,0,0,0,0,0,35,334,1,0,74.4,26.4],[925,3,2018,16,0,1,0,0,0,3,-8,1,66,750,13,1,222.2,104.2],[1185,3,2017,15,0,0,0,0,0,0,0,0,80,690,4,2,169.0,79.3],[896,3,2016,14,0,0,0,0,0,0,0,0,35,406,6,0,113.6,53.3],[1186,3,2020,12,0,0,0,0,0,2,3,2,28,250,3,0,83.3,39.1]],"PHI|3":[[1187,0,2017,13,265,440,3296,33,7,64,299,0,0,0,0,3,281.7,85.3],[1188,0,2020,14,77,148,1061,6,4,63,354,3,1,3,0,2,109.1,28.1],[862,0,2018,5,141,195,1413,7,4,9,17,0,1,10,0,2,76.2,25.7],[1189,1,2019,16,0,0,0,0,0,179,818,3,50,509,3,1,218.7,73.4],[719,1,2016,15,0,0,0,0,0,94,438,2,52,427,2,0,162.5,54.5],[720,1,2016,13,0,0,0,0,0,155,661,8,13,115,1,2,144.6,47.4],[1190,1,2018,16,0,0,0,0,0,87,364,3,28,230,2,1,117.4,38.3],[1191,1,2019,9,0,0,0,0,0,119,525,6,10,69,1,0,111.4,37.1],[523,1,2017,16,0,0,0,0,0,173,766,2,8,50,1,1,107.6,36.1],[1000,2,2017,16,0,0,0,0,0,0,0,0,57,789,9,0,195.9,69.6],[868,2,2017,16,0,0,0,0,0,1,7,0,62,768,8,0,187.5,66.6],[1192,2,2020,16,1,1,15,0,0,2,-4,0,53,419,6,0,133.1,47.3],[1193,2,2020,12,0,0,0,0,0,0,0,0,38,539,4,0,115.9,41.2],[830,2,2017,16,0,0,0,0,0,1,-3,0,36,430,2,0,90.7,32.2],[1194,2,2020,11,0,0,0,0,0,4,26,0,31,396,1,0,87.2,31.0],[817,2,2016,14,0,0,0,0,0,0,0,0,36,392,2,0,87.2,31.0],[920,2,2018,8,0,0,0,0,0,1,-8,0,30,278,1,0,65.0,23.1],[871,3,2018,16,0,0,0,0,0,0,0,0,116,1163,8,0,280.3,130],[870,3,2016,14,0,0,0,0,0,0,0,0,73,804,3,0,171.4,80.4],[1195,3,2019,15,0,0,0,0,0,0,0,0,58,607,5,2,144.7,67.9],[1186,3,2017,14,0,0,0,0,0,0,0,0,23,248,5,0,79.8,37.4]],"NYJ|3":[[167,0,2017,13,267,397,2926,18,9,37,124,5,0,0,0,4,205.4,63.4],[1196,0,2019,13,273,441,3024,19,13,33,62,2,0,0,0,3,189.2,53.4],[702,0,2016,14,228,403,2710,12,17,33,130,0,0,0,0,1,133.4,30.4],[857,1,2016,16,0,0,0,0,0,131,722,3,58,388,2,1,197.0,69.8],[822,1,2019,15,0,0,0,0,0,245,789,3,66,461,1,1,215.0,63.9],[596,1,2016,14,0,0,0,0,0,218,813,7,30,263,1,1,183.6,56.8],[1006,1,2018,13,0,0,0,0,0,143,685,6,21,152,0,0,140.7,48.5],[440,1,2020,15,0,0,0,0,0,187,653,2,16,89,0,1,100.2,28.2],[1197,1,2018,8,0,0,0,0,0,92,276,3,19,193,1,2,85.9,24.5],[1198,2,2017,16,0,0,0,0,0,3,9,0,63,941,7,0,200.0,71.0],[884,2,2019,16,0,0,0,0,0,1,4,0,78,833,6,0,197.7,70.2],[1037,2,2017,16,0,0,0,0,0,0,0,0,65,810,5,0,176.0,62.5],[1199,2,2016,16,0,0,0,0,0,1,12,0,58,857,4,0,168.9,60.0],[516,2,2016,15,0,0,0,0,0,0,0,0,59,788,3,0,155.8,55.3],[1085,2,2020,12,0,0,0,0,0,1,6,0,30,505,3,0,99.1,35.2],[1200,2,2020,16,0,0,0,0,0,3,29,0,37,394,3,0,97.3,34.6],[518,2,2019,11,0,0,0,0,0,0,0,0,36,433,1,0,85.3,30.3],[1201,3,2018,14,0,0,0,0,0,0,0,0,39,502,4,0,113.2,53.1],[951,3,2017,13,0,0,0,0,0,0,0,0,50,357,3,1,101.7,47.7],[1202,3,2019,13,0,0,0,0,0,0,0,0,34,320,5,0,98.0,46.0]],"WAS|3":[[878,0,2016,16,406,606,4917,25,12,34,96,4,0,0,0,3,300.3,92.3],[785,0,2018,10,205,328,2180,10,5,41,168,1,0,0,0,1,138.0,38.8],[953,0,2019,10,160,247,1707,11,5,9,12,1,0,0,0,3,103.5,31.0],[1203,0,2019,9,119,203,1365,7,7,20,101,0,0,0,0,2,76.7,18.4],[1204,1,2020,14,0,0,0,0,0,170,795,11,36,247,0,2,202.2,68.5],[1205,1,2020,16,0,0,0,0,0,85,365,1,80,589,2,1,191.4,62.9],[696,1,2018,16,0,0,0,0,0,251,1042,7,20,208,1,2,189.0,61.2],[882,1,2016,16,0,0,0,0,0,68,356,3,49,349,2,1,147.5,50.5],[1206,1,2016,14,0,0,0,0,0,168,704,6,12,82,1,0,132.6,43.0],[1207,1,2017,13,0,0,0,0,0,175,603,1,22,182,1,2,108.5,31.0],[1208,2,2020,15,0,0,0,0,0,2,30,0,87,1118,4,1,223.8,79.5],[660,2,2016,16,0,0,0,0,0,0,0,0,79,1041,3,0,201.1,71.4],[884,2,2016,16,0,0,0,0,0,2,-2,0,67,847,7,1,197.5,70.2],[727,2,2016,15,0,0,0,0,0,0,0,0,56,1005,4,0,180.5,64.1],[1184,2,2017,16,0,0,0,0,0,0,0,0,45,573,4,0,126.3,44.9],[1209,2,2017,15,0,0,0,0,0,1,-14,0,35,502,6,0,119.8,42.6],[1210,2,2019,16,0,1,0,0,0,9,85,1,34,310,4,0,109.5,38.9],[1211,2,2020,13,0,0,0,0,0,1,5,0,32,477,1,0,86.2,30.6],[1212,3,2020,16,1,1,28,0,0,3,5,0,72,670,6,0,176.6,82.8],[885,3,2016,12,0,0,0,0,0,0,0,0,66,686,6,1,168.6,79.1],[792,3,2017,16,0,0,0,0,0,0,0,0,43,648,3,2,121.8,57.1],[1213,3,2019,16,0,0,0,0,0,0,0,0,26,241,1,0,56.1,26.3]],"JAX|3":[[1061,0,2016,16,368,625,3905,23,16,58,359,3,1,20,1,6,271.1,75.0],[1214,0,2019,14,285,470,3271,21,6,67,344,0,0,0,0,7,229.2,66.8],[1215,1,2019,15,0,0,0,0,0,265,1152,3,76,522,0,1,259.4,85.6],[1216,1,2020,14,0,0,0,0,0,240,1070,7,49,344,3,1,250.4,83.3],[1062,1,2018,14,0,0,0,0,0,104,414,1,55,487,4,1,173.1,55.9],[679,1,2016,11,0,0,0,0,0,117,439,3,20,186,0,3,94.5,29.1],[1217,1,2019,14,0,0,0,0,0,35,108,0,14,144,2,0,51.2,15.5],[1218,2,2019,15,0,0,0,0,0,2,20,0,73,1008,8,0,225.8,80.2],[1065,2,2016,16,0,0,0,0,0,0,0,0,73,883,6,0,199.3,70.8],[1219,2,2018,16,0,1,0,0,0,9,98,0,66,717,5,2,179.5,63.8],[1070,2,2016,16,1,1,20,1,0,6,35,0,63,851,3,1,178.4,63.4],[1220,2,2020,14,0,0,0,0,0,18,91,0,58,600,5,0,157.1,55.8],[1163,2,2019,16,0,0,0,0,0,0,0,0,47,775,5,0,156.5,55.6],[1221,2,2020,16,0,0,0,0,0,1,2,0,55,642,5,0,155.4,55.2],[894,2,2018,16,0,0,0,0,0,0,0,0,48,668,3,1,130.8,46.5],[771,3,2017,16,0,0,0,0,0,0,0,0,24,318,5,0,87.8,41.2],[1031,3,2020,15,0,0,0,0,0,0,0,0,36,349,2,0,82.9,38.9],[978,3,2016,9,0,0,0,0,0,0,0,0,30,281,4,0,82.1,38.5],[1222,3,2020,15,0,0,0,0,0,0,0,0,28,262,0,0,54.2,25.4]],"TEN|3":[[1071,0,2020,16,315,481,3819,33,7,43,266,7,1,0,0,1,344.4,107.5],[811,0,2016,15,276,451,3426,26,9,60,349,2,0,0,0,5,259.9,77.4],[1223,1,2020,16,0,0,0,0,0,378,2027,17,19,114,0,2,333.1,116.2],[863,1,2016,16,1,2,10,1,0,293,1287,9,53,377,3,1,293.8,97.2],[840,1,2018,16,0,0,0,0,0,155,517,1,59,400,1,1,160.7,48.1],[1224,2,2020,14,0,0,0,0,0,0,0,0,70,1075,11,1,247.5,87.9],[1077,2,2016,16,0,0,0,0,0,0,0,0,65,945,9,1,211.5,75.1],[1225,2,2020,14,0,0,0,0,0,0,0,0,65,984,5,1,191.4,68.0],[858,2,2017,16,0,1,0,0,0,0,0,0,54,563,1,0,116.3,41.3],[1226,2,2016,16,0,0,0,0,0,1,1,0,41,522,2,0,105.3,37.4],[815,2,2016,11,0,0,0,0,0,1,15,0,29,416,3,0,90.1,32.0],[1227,2,2018,13,0,0,0,0,0,0,0,0,37,466,1,1,87.6,31.1],[1228,2,2019,12,0,0,0,0,0,1,1,0,37,374,2,0,86.5,30.7],[793,3,2016,15,0,0,0,0,0,2,11,0,65,800,7,0,188.1,88.2],[1229,3,2020,14,0,0,0,0,0,2,4,1,41,448,8,0,140.2,65.8],[1230,3,2020,15,0,0,0,0,0,0,0,0,39,387,1,0,83.7,39.3],[1231,3,2018,12,0,0,0,0,0,1,0,0,15,165,2,0,43.5,20.4]],"CAR|3":[[873,0,2018,14,320,471,3395,24,13,101,488,4,0,0,0,0,282.6,86.6],[962,0,2020,15,340,492,3733,15,11,53,279,5,0,0,0,3,241.2,74.1],[1232,0,2019,13,303,489,3322,17,16,32,106,2,0,0,0,7,177.5,48.7],[1233,1,2019,16,0,2,0,0,0,287,1387,15,116,1005,4,0,471.2,130],[1234,1,2020,15,0,0,0,0,0,165,642,6,59,373,2,1,206.5,65.8],[616,1,2016,13,0,0,0,0,0,218,824,9,8,60,0,2,146.4,44.9],[1235,1,2016,16,0,0,0,0,0,57,265,0,25,226,0,1,72.1,24.3],[1236,2,2019,15,0,0,0,0,0,6,40,0,87,1175,4,1,230.5,81.9],[1198,2,2020,16,0,0,0,0,0,4,15,0,95,1096,3,1,224.1,79.6],[1237,2,2020,15,0,0,0,0,0,41,200,2,77,851,3,0,212.1,75.3],[874,2,2016,16,0,0,0,0,0,0,0,0,63,941,7,1,197.1,70.0],[875,2,2017,16,0,0,0,0,0,0,0,0,63,840,8,0,195.0,69.3],[552,2,2016,16,0,0,0,0,0,14,98,0,54,752,4,2,159.0,56.5],[968,2,2018,16,0,0,0,0,0,2,39,0,43,447,1,1,97.6,34.7],[876,2,2016,16,0,0,0,0,0,2,6,0,27,276,1,1,59.2,21.0],[604,3,2016,16,0,0,0,0,0,0,0,0,80,1073,3,0,207.3,97.2],[1238,3,2018,10,0,0,0,0,0,0,0,0,36,333,2,0,81.3,38.1],[836,3,2017,14,0,0,0,0,0,0,0,0,30,437,1,0,79.7,37.4]],"NE|3":[[63,0,2017,16,385,581,4577,32,8,25,28,0,0,0,0,3,295.9,92.3],[873,0,2020,15,242,368,2657,8,10,137,592,12,2,35,1,1,261.0,76.0],[1239,1,2018,16,0,0,0,0,0,94,425,5,87,751,7,0,276.6,91.6],[523,1,2016,16,0,0,0,0,0,299,1161,18,7,38,0,1,232.9,74.0],[840,1,2017,16,0,0,0,0,0,180,896,6,32,214,3,0,203.0,70.6],[1240,1,2018,13,0,0,0,0,0,209,931,6,7,50,0,1,139.1,46.7],[1241,1,2017,10,0,0,0,0,0,64,264,5,30,254,3,0,129.8,42.3],[1242,1,2020,10,0,0,0,0,0,137,691,2,5,52,0,0,91.3,33.3],[841,2,2019,16,2,2,47,1,0,8,27,0,100,1117,6,1,256.3,91.0],[910,2,2017,16,0,0,0,0,0,9,40,0,65,1082,7,0,221.2,78.6],[1243,2,2020,12,2,2,43,2,0,2,9,0,59,729,0,1,142.5,50.6],[569,2,2017,15,0,0,0,0,0,0,0,0,61,659,2,0,138.9,49.3],[1009,2,2018,11,0,0,0,0,0,0,0,0,40,720,3,0,130.0,46.2],[1058,2,2016,15,0,0,0,0,0,3,9,0,38,680,4,1,128.9,45.8],[1099,2,2020,15,0,0,0,0,0,2,15,0,47,604,1,0,114.9,40.8],[1183,2,2019,11,0,0,0,0,0,3,21,0,29,397,5,0,100.8,35.8],[563,3,2017,13,0,0,0,0,0,0,0,0,69,1084,8,0,227.4,106.7],[546,3,2016,16,0,0,0,0,0,2,10,0,55,701,7,0,168.1,78.8],[1244,3,2020,13,0,0,0,0,0,2,0,0,33,309,2,1,73.9,34.7]],"ATL|3":[[634,0,2016,16,373,534,4944,38,7,35,117,0,0,0,0,2,347.5,113.2],[803,1,2016,16,0,0,0,0,0,227,1079,11,54,462,2,1,284.1,96.3],[1245,1,2018,16,0,0,0,0,0,167,800,4,32,276,5,0,193.6,66.3],[980,1,2020,15,0,0,0,0,0,195,678,9,25,164,0,0,163.2,48.6],[1246,1,2020,16,0,0,0,0,0,100,465,1,25,199,0,1,95.4,32.5],[1247,1,2018,13,0,0,0,0,0,90,315,4,27,152,0,0,97.7,29.9],[806,2,2018,16,0,0,0,0,0,2,12,0,113,1677,8,2,325.9,115.8],[1248,2,2020,15,0,0,0,0,0,5,1,0,90,1374,9,1,281.5,100.0],[1030,2,2018,16,1,2,5,1,0,7,44,0,66,838,4,1,182.4,64.8],[1249,2,2020,16,1,2,39,1,0,2,9,0,72,786,4,0,181.1,64.3],[1013,2,2016,12,0,0,0,0,0,4,51,1,35,579,6,0,140.0,49.7],[1250,2,2016,13,0,0,0,0,0,0,0,0,21,203,4,0,65.3,23.2],[1251,2,2016,13,0,0,0,0,0,0,0,0,20,323,2,0,64.3,22.8],[1252,2,2020,10,0,0,0,0,0,1,0,0,20,274,1,0,53.4,19.0],[1253,3,2019,13,0,0,0,0,0,0,0,0,75,787,6,0,191.7,89.9],[1087,3,2020,16,0,0,0,0,0,0,0,0,56,571,6,0,149.1,69.9],[664,3,2016,8,0,0,0,0,0,0,0,0,22,210,3,0,61.0,28.6],[810,3,2016,13,0,0,0,0,0,0,0,0,13,264,2,0,51.4,24.1]],"CHI|3":[[1254,0,2018,14,289,434,3223,24,12,68,421,3,0,0,0,3,263.0,80.5],[862,0,2020,9,202,312,1852,10,8,16,1,1,0,0,0,0,104.2,28.3],[952,0,2016,6,134,200,1445,6,0,7,-2,0,0,0,0,1,79.6,25.8],[1255,0,2016,7,129,216,1611,8,14,7,2,0,1,2,1,2,71.8,15.4],[1256,1,2020,15,0,0,0,0,0,247,1070,8,54,438,2,1,264.8,87.3],[1191,1,2016,15,0,0,0,0,0,252,1313,6,29,298,1,1,230.1,81.4],[1257,1,2018,16,1,1,1,1,0,99,444,3,71,725,5,3,233.9,77.5],[998,1,2016,12,0,0,0,0,0,62,200,4,19,142,0,2,73.2,22.0],[965,1,2020,16,0,0,0,0,0,64,232,1,21,132,0,0,69.4,21.5],[983,1,2017,14,0,0,0,0,0,9,29,0,20,240,2,1,56.9,18.4],[1065,2,2020,16,0,0,0,0,0,1,-1,0,102,1250,6,0,262.9,93.4],[1258,2,2016,14,1,1,2,1,0,1,6,0,66,888,4,2,179.5,63.8],[1259,2,2020,16,0,0,0,0,0,4,20,0,61,631,4,0,152.1,54.0],[1013,2,2018,16,0,0,0,0,0,9,61,0,67,688,2,1,151.9,54.0],[1000,2,2016,12,0,0,0,0,0,0,0,0,52,821,2,0,146.1,51.9],[1260,2,2019,16,0,0,0,0,0,1,-1,0,52,656,2,1,127.5,45.3],[815,2,2017,15,0,0,0,0,0,0,0,0,59,614,1,0,126.4,44.9],[517,2,2016,9,0,0,0,0,0,0,0,0,33,369,2,0,87.9,31.2],[1186,3,2018,16,0,0,0,0,0,1,2,0,54,569,6,1,147.1,69.0],[685,3,2020,16,0,0,0,0,0,0,0,0,50,456,8,0,143.6,67.4],[772,3,2016,10,0,0,0,0,0,0,0,0,47,486,4,0,119.6,56.1],[1261,3,2020,15,0,0,0,0,0,1,-3,0,28,243,2,1,62.0,29.1]],"CLE|3":[[1262,0,2020,16,305,486,3563,26,8,54,165,1,1,6,0,4,248.6,74.8],[1263,0,2017,15,255,476,2894,11,22,77,419,5,0,0,0,6,175.7,39.2],[1264,0,2016,9,128,195,1380,6,2,11,18,0,0,0,0,1,77.0,23.5],[1265,1,2019,16,0,0,0,0,0,298,1494,8,36,278,0,3,255.2,88.4],[1158,1,2020,16,0,0,0,0,0,198,841,6,38,304,5,0,218.5,71.5],[1005,1,2017,16,0,0,0,0,0,82,348,4,74,693,3,2,216.1,70.9],[1006,1,2016,16,0,0,0,0,0,198,952,7,40,319,0,2,205.1,70.6],[1018,1,2018,6,0,0,0,0,0,114,382,5,6,29,0,0,77.1,22.0],[1076,2,2019,16,0,0,0,0,0,1,10,0,83,1174,6,0,237.4,84.3],[1047,2,2016,16,5,9,41,0,0,8,21,1,77,1007,4,0,213.4,75.8],[992,2,2019,16,1,2,20,0,0,3,10,0,74,1035,4,1,201.3,71.5],[1266,2,2018,16,0,0,0,0,0,2,7,0,43,586,5,1,132.3,47.0],[1267,2,2020,12,0,0,0,0,0,0,0,0,37,599,4,0,120.9,42.9],[1268,2,2016,10,0,0,0,0,0,2,10,0,33,413,3,0,93.3,33.1],[1011,2,2016,16,0,0,0,0,0,2,0,0,33,324,3,0,83.4,29.6],[1269,2,2017,14,0,0,0,0,0,0,0,0,27,357,0,0,62.7,22.3],[1270,3,2018,15,0,0,0,0,0,0,0,0,56,639,4,0,143.9,67.5],[623,3,2016,16,0,0,0,0,0,0,0,0,55,612,2,0,130.2,61.1],[1253,3,2020,13,0,0,0,0,0,0,0,0,46,435,4,0,113.5,53.2],[1271,3,2017,16,0,0,0,0,0,0,0,0,33,395,1,1,76.5,35.9]],"LV|3":[[1041,0,2020,16,348,517,4103,27,9,39,140,3,0,0,0,8,272.1,85.2],[1272,1,2020,15,0,0,0,0,0,273,1065,12,33,238,0,2,231.3,73.6],[1043,1,2016,14,0,0,0,0,0,195,788,12,33,264,0,1,208.2,66.9],[642,1,2017,15,0,0,0,0,0,207,891,7,20,151,0,1,164.2,54.1],[1273,1,2018,16,0,0,0,0,0,55,259,1,68,607,0,2,156.6,52.2],[943,1,2018,16,0,0,0,0,0,172,723,4,18,116,0,3,119.9,38.9],[1274,1,2019,16,0,0,0,0,0,108,387,3,36,292,0,0,121.9,37.7],[789,2,2016,16,0,0,0,0,0,0,0,0,89,1003,8,0,239.3,85.0],[1044,2,2016,16,0,0,0,0,0,1,0,0,83,1153,5,0,232.3,82.5],[868,2,2020,16,0,0,0,0,0,0,0,0,48,896,8,0,185.6,65.9],[631,2,2018,15,0,0,0,0,0,1,-2,0,63,739,3,0,156.7,55.7],[1107,2,2019,13,0,0,0,0,0,0,0,0,42,651,6,0,143.1,50.8],[1275,2,2019,13,0,0,0,0,0,0,0,0,49,605,4,0,133.5,47.4],[1276,2,2016,16,0,0,0,0,0,0,0,0,38,397,5,0,111.7,39.7],[1277,2,2020,13,0,0,0,0,0,9,49,0,26,452,2,2,84.1,29.9],[1278,3,2020,16,0,0,0,0,0,0,0,0,107,1196,9,2,278.6,130],[614,3,2018,16,0,0,0,0,0,0,0,0,68,896,6,0,193.6,90.8],[1050,3,2016,15,0,0,0,0,0,0,0,0,33,359,3,0,86.9,40.8],[1279,3,2019,11,0,0,0,0,0,0,0,0,21,174,5,0,68.4,32.1]],"LA|3":[[1280,0,2018,16,364,561,4688,32,12,43,108,2,0,0,0,5,310.3,95.5],[953,0,2016,10,196,322,2201,9,11,20,51,1,0,0,0,1,111.1,27.5],[980,1,2017,15,0,0,0,0,0,279,1305,13,64,788,6,2,383.3,128.4],[1281,1,2020,15,0,0,0,0,0,138,624,5,16,159,1,0,130.3,43.8],[1282,1,2020,16,0,0,0,0,0,101,419,5,23,162,0,1,109.1,35.4],[1283,1,2020,11,0,0,0,0,0,145,625,2,11,123,1,1,101.8,33.5],[973,1,2018,2,0,0,0,0,0,43,299,2,4,17,0,0,47.6,19.3],[1284,2,2019,16,0,1,0,0,0,2,4,0,94,1161,10,0,270.5,96.1],[1057,2,2018,16,0,0,0,0,0,19,157,1,86,1219,6,0,265.6,94.3],[910,2,2018,15,0,0,0,0,0,10,68,1,80,1204,5,0,243.2,86.4],[609,2,2016,15,0,0,0,0,0,0,0,0,68,1002,5,1,196.2,69.7],[985,2,2016,15,0,0,0,0,0,28,159,1,58,509,3,1,146.8,52.1],[1056,2,2017,15,0,0,0,0,0,0,0,0,39,593,8,0,146.3,52.0],[1285,2,2020,16,0,0,0,0,0,1,5,0,52,618,2,1,124.3,44.2],[1286,2,2016,16,0,0,0,0,0,0,0,0,41,564,3,0,115.4,41.0],[1287,3,2019,14,0,0,0,0,0,0,0,0,69,734,3,0,160.4,75.2],[988,3,2016,16,0,0,0,0,0,0,0,0,50,499,2,1,109.9,51.5],[1288,3,2020,15,0,0,0,0,0,1,2,1,41,417,1,1,92.9,43.6]],"BUF|3":[[1289,0,2020,16,396,572,4544,37,10,102,421,8,1,12,1,6,396.1,124.6],[1051,0,2016,15,269,436,3023,17,6,95,580,6,0,0,0,2,270.9,79.2],[726,1,2016,15,0,0,0,0,0,234,1267,13,50,356,1,0,298.3,105.1],[1290,1,2019,12,0,0,0,0,0,151,775,2,29,194,2,1,147.9,52.6],[1055,1,2016,15,0,0,0,0,0,101,577,8,9,50,1,0,125.7,45.8],[1291,1,2020,13,0,0,0,0,0,112,481,4,14,95,1,0,101.6,33.4],[440,1,2019,15,0,0,0,0,0,166,599,2,13,100,0,0,94.9,27.6],[679,1,2018,13,0,0,0,0,0,115,385,1,13,205,0,0,78.0,22.2],[967,2,2020,16,0,0,0,0,0,1,1,0,127,1535,8,0,328.6,116.7],[902,2,2019,15,1,1,28,1,0,2,7,0,72,1060,6,0,219.8,78.1],[937,2,2020,15,1,1,20,1,0,0,0,0,82,967,4,0,207.5,73.7],[1292,2,2018,16,0,1,0,0,0,1,0,0,56,652,7,0,165.2,58.7],[1293,2,2020,16,0,0,0,0,0,1,0,0,35,599,7,0,136.9,48.6],[1057,2,2016,13,0,0,0,0,0,1,6,0,51,613,1,0,118.9,42.2],[1294,2,2020,15,1,1,12,1,0,10,9,0,30,282,5,0,99.6,35.4],[1295,2,2018,11,0,0,0,0,0,0,0,0,27,541,3,0,99.1,35.2],[1060,3,2016,15,0,0,0,0,0,0,0,0,57,552,4,0,136.2,63.9],[1296,3,2019,15,0,0,0,0,0,1,9,0,28,388,2,0,79.7,37.4],[1297,3,2017,13,0,0,0,0,0,0,0,0,22,322,2,1,64.2,30.1],[870,3,2017,10,0,0,0,0,0,0,0,0,25,282,1,1,57.2,26.8]],"CIN|3":[[1024,0,2016,16,364,563,4206,18,8,46,184,4,0,0,0,3,260.6,78.0],[1298,0,2020,10,264,404,2688,13,5,37,142,3,0,0,0,4,173.7,51.8],[1299,0,2018,8,105,176,1003,6,2,25,130,2,0,0,0,1,85.1,22.7],[1300,1,2018,14,0,0,0,0,0,237,1168,8,43,296,1,0,243.4,84.0],[1025,1,2016,15,0,0,0,0,0,222,839,9,21,174,0,0,176.3,54.7],[1026,1,2017,16,0,0,0,0,0,105,458,2,43,389,2,0,151.7,50.1],[1241,1,2016,14,0,0,0,0,0,74,344,2,17,145,0,1,75.9,25.8],[1207,1,2020,12,0,0,0,0,0,63,301,3,11,66,0,0,65.7,22.6],[1028,2,2017,16,0,0,0,0,0,0,0,0,75,1078,8,2,226.8,80.6],[1301,2,2019,16,0,0,0,0,0,4,23,0,90,1046,5,2,222.9,79.2],[1302,2,2020,15,0,0,0,0,0,5,28,0,67,908,6,1,194.6,69.1],[620,2,2016,16,0,0,0,0,0,1,-2,0,64,862,6,0,186.0,66.1],[1303,2,2019,12,0,0,0,0,0,0,0,0,40,575,1,1,101.5,36.1],[1304,2,2019,16,1,1,26,0,0,5,33,0,43,529,0,2,96.2,34.2],[1305,2,2019,8,0,0,0,0,0,3,4,0,28,506,3,1,95.0,33.7],[1306,3,2017,16,0,0,0,0,0,0,0,0,42,404,7,0,124.4,58.3],[1031,3,2019,16,0,0,0,0,0,0,0,0,43,436,3,0,106.6,50.0],[1307,3,2018,16,0,0,0,0,0,0,0,0,43,439,3,0,104.9,49.2],[1308,3,2020,16,0,0,0,0,0,0,0,0,40,349,1,1,78.9,37.0]],"DEN|3":[[953,0,2018,16,365,586,3890,18,15,26,93,2,0,0,0,2,214.9,60.4],[1309,0,2016,14,289,486,3401,18,10,28,57,0,0,0,0,2,191.7,53.3],[1310,0,2020,13,254,443,2933,16,15,44,160,3,0,0,0,3,181.3,46.7],[709,0,2019,8,171,262,1822,6,5,12,20,0,0,0,0,3,84.9,24.1],[1311,1,2018,15,0,0,0,0,0,192,1037,9,35,241,1,0,222.8,79.9],[928,1,2020,15,0,0,0,0,0,215,986,9,32,158,1,4,198.4,67.1],[973,1,2017,16,0,0,0,0,0,245,1007,3,28,224,1,1,175.1,56.4],[1312,1,2019,16,0,0,0,0,0,132,496,3,43,256,1,0,142.2,44.5],[1313,1,2016,16,0,0,0,0,0,174,612,4,31,265,1,3,142.7,42.7],[648,1,2017,13,0,0,0,0,0,69,296,1,23,129,0,2,67.5,22.2],[518,2,2016,16,0,0,0,0,0,0,0,0,90,1083,5,2,226.3,80.4],[1314,2,2019,16,1,1,38,0,0,3,17,0,72,1112,6,0,222.4,79.0],[777,2,2016,15,0,0,0,0,0,1,4,0,79,1032,5,0,212.6,75.5],[1315,2,2020,15,0,0,0,0,0,0,0,0,51,742,6,0,161.2,57.3],[1316,2,2020,16,0,0,0,0,0,0,0,0,52,856,3,0,157.6,56.0],[1317,2,2020,12,0,0,0,0,0,9,40,0,30,381,3,0,90.1,32.0],[1318,2,2017,16,0,0,0,0,0,0,0,0,29,350,3,0,82.0,29.1],[1319,2,2018,11,0,0,0,0,0,0,0,0,30,243,2,0,66.3,23.6],[1320,3,2020,14,0,0,0,0,0,0,0,0,62,673,3,0,149.3,70.0],[1321,3,2018,11,0,0,0,0,0,0,0,0,31,281,2,0,71.1,33.3],[1322,3,2018,13,0,0,0,0,0,0,0,0,24,250,1,0,55.0,25.8],[1112,3,2016,10,0,0,0,0,0,0,0,0,22,237,1,0,51.7,24.2]],"SEA|3":[[1032,0,2020,16,384,558,4212,40,13,83,513,2,0,0,0,4,359.8,113.0],[1323,1,2019,15,0,0,0,0,0,278,1230,7,37,266,2,4,232.6,77.3],[1234,1,2018,15,0,0,0,0,0,112,514,4,34,214,1,0,136.8,46.0],[1324,1,2016,9,0,0,0,0,0,117,469,6,20,96,1,1,116.5,37.2],[1205,1,2017,12,0,0,0,0,0,46,187,1,34,266,2,0,97.3,31.6],[1018,1,2020,10,0,0,0,0,0,81,356,4,16,93,0,0,84.9,28.2],[1325,1,2019,9,0,0,0,0,0,65,370,3,8,83,1,1,75.3,27.6],[1326,2,2020,16,0,0,0,0,0,0,0,0,83,1303,10,1,271.3,96.4],[1036,2,2020,16,0,0,0,0,0,0,0,0,100,1054,10,0,265.4,94.3],[1035,2,2016,16,1,1,15,1,0,3,2,0,94,1128,7,0,253.6,90.1],[1038,2,2017,16,0,0,0,0,0,0,0,0,44,703,6,0,150.3,53.4],[1327,2,2020,16,0,0,0,0,0,8,61,0,35,417,6,0,118.8,42.2],[1037,2,2016,16,0,0,0,0,0,0,0,0,41,510,1,0,98.0,34.8],[904,2,2018,12,0,0,0,0,0,0,0,0,14,166,5,0,60.6,21.5],[1328,2,2019,11,0,0,0,0,0,0,0,0,15,245,1,0,45.5,16.2],[685,3,2016,16,0,0,0,0,0,1,0,0,65,923,6,2,189.3,88.8],[1329,3,2019,10,0,0,0,0,0,0,0,0,41,349,3,0,93.9,44.0],[1330,3,2018,15,0,0,0,0,0,0,0,0,29,269,3,0,73.9,34.7],[1331,3,2019,6,0,0,0,0,0,1,7,0,23,262,4,0,73.9,34.7]],"SF|3":[[1332,0,2019,16,329,476,3978,27,13,46,62,1,0,0,0,5,247.3,78.8],[1015,0,2016,11,196,331,2241,16,4,69,468,2,0,0,0,3,200.4,57.5],[1333,0,2018,8,176,274,2277,13,10,18,-16,0,0,0,0,0,123.5,36.7],[1334,0,2018,5,102,169,1252,8,7,19,69,1,0,0,0,3,75.0,19.9],[1018,1,2017,16,0,0,0,0,0,240,938,8,59,350,0,1,233.8,74.4],[1335,1,2019,16,0,0,0,0,0,137,772,8,14,180,2,2,165.2,60.1],[1336,1,2018,14,0,0,0,0,0,153,814,3,27,261,2,1,162.5,58.4],[1337,1,2020,11,0,0,0,0,0,126,600,7,13,133,3,2,142.3,48.6],[1245,1,2019,14,0,0,0,0,0,137,544,6,21,180,1,0,135.4,43.1],[966,1,2020,14,0,0,0,0,0,81,319,5,33,253,1,0,126.2,40.6],[1338,2,2019,15,0,0,0,0,0,14,159,3,57,802,3,1,189.1,67.2],[1339,2,2020,12,0,0,0,0,0,6,77,2,60,748,5,0,184.5,65.5],[1340,2,2017,16,0,0,0,0,0,4,44,0,56,962,2,0,168.6,59.9],[859,2,2016,16,0,0,0,0,0,0,0,0,64,667,3,1,146.7,52.1],[1341,2,2020,15,0,0,0,0,0,0,0,0,49,667,2,0,129.7,46.1],[777,2,2019,10,1,1,35,1,0,0,0,0,36,502,3,0,109.6,38.9],[1342,2,2018,12,0,0,0,0,0,1,-2,0,27,467,5,0,103.5,36.8],[1343,2,2017,15,0,0,0,0,0,0,0,0,43,430,2,1,96.0,34.1],[1344,3,2018,16,0,0,0,0,0,1,10,0,88,1377,5,0,258.7,121.3],[1022,3,2016,10,0,0,0,0,0,0,0,0,24,391,4,0,87.1,40.9],[1023,3,2016,14,0,0,0,0,0,0,0,0,29,350,3,1,80.0,37.5],[885,3,2020,10,0,0,0,0,0,0,0,0,26,231,4,0,73.1,34.3]],"MIN|3":[[878,0,2020,16,349,516,4265,35,13,32,156,1,0,0,0,5,306.2,96.5],[953,0,2017,15,325,481,3547,22,7,40,160,1,0,0,0,1,237.9,74.3],[565,0,2016,15,395,552,3877,20,5,20,53,0,1,5,0,5,221.9,71.4],[1345,1,2020,14,0,0,0,0,0,312,1557,16,44,361,1,3,337.8,115.4],[966,1,2017,16,0,0,0,0,0,150,570,3,51,421,2,2,178.1,56.2],[1043,1,2017,16,0,0,0,0,0,216,842,8,15,103,0,0,157.5,49.3],[964,1,2016,16,0,0,0,0,0,121,402,6,32,263,0,1,132.5,39.9],[965,1,2016,16,0,0,0,0,0,7,43,0,52,453,2,0,119.6,39.7],[1346,1,2020,13,0,0,0,0,0,96,434,2,13,125,1,0,86.9,29.3],[1347,2,2018,16,0,0,0,0,0,5,30,0,113,1373,9,1,307.3,109.2],[1348,2,2020,16,0,0,0,0,0,1,2,0,88,1400,7,0,274.2,97.4],[967,2,2018,15,0,0,0,0,0,10,62,0,102,1021,9,0,266.3,94.6],[1349,2,2019,13,0,0,0,0,0,1,6,0,31,294,3,0,79.0,28.1],[1350,2,2018,15,0,0,0,0,0,0,0,0,35,302,1,0,71.2,25.3],[1251,2,2018,14,0,0,0,0,0,0,0,0,17,231,5,0,70.1,24.9],[1351,2,2020,14,0,0,0,0,0,0,0,0,20,201,2,1,50.1,17.8],[968,2,2017,12,0,0,0,0,0,0,0,0,18,198,2,0,49.8,17.7],[970,3,2016,16,0,0,0,0,0,0,0,0,83,840,7,0,209.0,98.0],[1352,3,2020,13,0,0,0,0,0,0,0,0,30,365,5,0,98.5,46.2],[1353,3,2020,9,0,0,0,0,0,0,0,0,19,194,1,0,44.4,20.8]],"TB|3":[[63,0,2020,16,401,610,4633,40,12,30,6,3,0,0,0,1,337.9,104.4],[941,0,2019,16,380,626,5109,33,30,59,250,1,0,0,0,5,305.4,87.6],[702,0,2018,8,164,246,2366,17,12,36,152,2,0,0,0,1,165.8,52.4],[1354,1,2020,14,0,0,0,0,0,192,978,7,28,165,1,2,186.3,66.1],[1355,1,2018,16,0,0,0,0,0,234,871,5,20,92,1,1,150.3,45.8],[1215,1,2020,12,0,0,0,0,0,97,367,6,36,233,0,0,132.0,41.8],[804,1,2016,10,0,0,0,0,0,129,560,2,13,98,0,0,90.8,30.0],[944,1,2017,15,0,0,0,0,0,21,95,0,35,249,1,1,73.4,24.3],[1356,1,2019,16,0,0,0,0,0,11,17,2,35,286,0,1,75.3,23.8],[947,2,2016,16,0,0,0,0,0,0,0,0,96,1321,12,0,304.1,108.0],[1357,2,2019,14,0,0,0,0,0,1,8,0,86,1333,9,0,276.1,98.1],[1228,2,2018,16,0,0,0,0,0,2,11,0,76,816,5,0,188.7,67.0],[727,2,2018,12,0,0,0,0,0,6,29,1,41,774,4,0,151.3,53.7],[1085,2,2019,14,0,0,0,0,0,2,16,0,36,645,6,0,138.1,49.1],[824,2,2020,8,0,0,0,0,0,2,-2,0,45,483,4,0,117.1,41.6],[1358,2,2020,14,0,0,0,0,0,3,14,0,33,501,3,0,102.5,36.4],[1359,2,2016,13,0,0,0,0,0,1,9,0,23,341,2,0,70.0,24.9],[1360,3,2016,15,0,0,0,0,0,0,0,0,57,660,8,0,171.0,80.2],[563,3,2020,16,0,0,0,0,0,0,0,0,45,623,7,0,149.3,70.0],[1361,3,2018,10,0,0,0,0,0,0,0,0,34,565,5,0,120.5,56.5]],"HOU|3":[[1362,0,2020,16,382,544,4823,33,7,90,444,3,0,0,0,3,369.3,118.5],[972,0,2016,15,301,510,2957,15,16,30,131,2,1,-14,0,1,169.0,42.8],[1073,1,2016,14,0,0,0,0,0,268,1073,5,31,188,1,1,191.1,61.0],[900,1,2020,12,0,0,0,0,0,147,691,6,33,314,2,1,179.5,60.9],[1005,1,2019,16,0,0,0,0,0,83,410,2,44,410,3,1,154.0,52.3],[1018,1,2019,16,0,0,0,0,0,245,1070,6,10,42,0,2,153.2,50.8],[955,1,2018,16,0,0,0,0,0,150,499,2,20,154,0,0,97.3,27.4],[1363,1,2017,9,0,0,0,0,0,78,327,2,6,83,0,1,57.0,18.5],[957,2,2018,16,0,1,0,0,0,1,-7,0,115,1572,11,2,333.5,118.5],[910,2,2020,15,0,0,0,0,0,0,0,0,81,1150,6,0,232.0,82.4],[1364,2,2020,11,0,0,0,0,0,1,0,0,53,879,8,0,188.9,67.1],[912,2,2019,13,0,0,0,0,0,0,0,0,40,561,4,0,120.1,42.7],[797,2,2020,10,0,1,0,0,0,0,0,0,38,441,3,0,100.1,35.6],[1365,2,2020,8,0,0,0,0,0,0,0,0,33,400,3,3,87.0,30.9],[1366,2,2017,11,0,0,0,0,0,3,17,0,29,330,2,0,75.7,26.9],[518,2,2018,7,0,0,0,0,0,0,0,0,23,275,2,0,62.5,22.2],[1367,3,2016,15,0,0,0,0,0,0,0,0,54,559,4,0,133.9,62.8],[907,3,2019,15,0,0,0,0,0,0,0,0,34,341,7,0,110.1,51.6],[1202,3,2016,16,0,0,0,0,0,0,0,0,50,442,2,1,104.2,48.9],[1368,3,2019,16,0,0,0,0,0,0,0,0,36,418,2,0,89.8,42.1]],"MIA|3":[[702,0,2019,15,311,502,3529,20,13,54,243,4,0,0,0,2,241.5,69.4],[1071,0,2016,13,261,389,2995,19,12,39,164,1,0,0,0,3,190.2,58.5],[509,0,2017,14,266,429,2666,19,14,19,32,0,0,0,0,0,157.8,43.1],[1369,0,2020,10,186,290,1814,11,5,36,109,3,0,0,0,1,135.5,39.2],[1370,1,2016,15,0,0,0,0,0,260,1272,8,27,151,0,1,215.3,74.5],[1095,1,2018,16,0,0,0,0,0,120,535,4,53,477,5,1,206.2,68.4],[1371,1,2020,10,0,0,0,0,0,142,584,3,41,388,2,2,164.2,53.2],[440,1,2018,14,0,0,0,0,0,156,722,0,12,124,1,0,102.6,35.4],[1075,1,2016,15,0,0,0,0,0,35,115,3,23,249,3,1,93.4,29.6],[1372,1,2020,6,0,0,0,0,0,75,319,3,11,61,0,0,69.0,22.6],[1076,2,2017,16,0,1,0,0,0,1,-7,0,112,987,9,2,260.0,92.4],[1078,2,2019,16,0,0,0,0,0,0,0,0,72,1202,9,0,246.2,87.5],[912,2,2017,16,0,0,0,0,0,0,0,0,58,847,6,2,174.7,62.1],[569,2,2018,15,1,1,28,1,0,1,-2,0,59,575,1,0,127.4,45.3],[851,2,2018,7,1,1,52,1,0,8,16,0,26,391,4,0,96.8,34.4],[1373,2,2019,8,0,0,0,0,0,0,0,0,32,428,3,1,90.8,32.3],[1374,2,2020,14,0,0,0,0,0,3,20,0,36,373,1,0,87.3,31.0],[1066,2,2019,14,0,0,0,0,0,0,0,0,32,416,2,1,83.6,29.7],[1375,3,2020,15,0,0,0,0,0,0,0,0,53,703,6,0,159.3,74.7],[978,3,2017,14,0,0,0,0,0,0,0,0,41,388,3,0,97.8,45.9],[1079,3,2016,13,0,0,0,0,0,0,0,0,26,256,4,0,75.6,35.5],[1376,3,2020,13,0,0,0,0,0,0,0,0,26,208,2,0,58.8,27.6]],"TB|4":[[1262,0,2024,17,407,570,4500,41,16,60,378,3,0,0,0,2,365.8,108.8],[63,0,2021,17,485,719,5316,43,12,28,81,2,0,0,0,3,374.7,107.8],[1377,1,2024,17,0,0,0,0,0,207,1122,8,47,392,0,1,244.4,86.3],[1215,1,2021,14,0,1,0,0,0,180,812,8,69,454,2,0,255.6,84.0],[1378,1,2023,17,0,0,0,0,0,272,990,6,64,549,3,2,267.9,82.5],[1379,1,2025,17,0,0,0,0,0,86,320,7,8,34,1,0,91.4,28.0],[1354,1,2021,15,0,0,0,0,0,101,428,4,10,64,0,2,79.2,25.4],[1026,1,2021,10,0,0,0,0,0,8,58,0,23,123,3,0,59.1,20.0],[947,2,2023,17,0,0,0,0,0,0,0,0,79,1255,13,0,282.5,96.2],[1357,2,2021,14,0,0,0,0,0,4,21,1,98,1103,5,2,242.4,82.5],[1380,2,2025,17,0,0,0,0,0,2,9,0,63,938,6,0,195.7,66.6],[1381,2,2024,13,0,0,0,0,0,4,43,0,37,461,8,0,135.4,46.1],[1249,2,2022,13,0,0,0,0,0,0,0,0,51,426,5,1,123.6,42.1],[824,2,2021,7,0,0,0,0,0,1,6,0,42,545,4,0,121.1,41.2],[1382,2,2023,17,0,0,0,0,0,3,22,0,39,385,3,1,95.7,32.6],[1383,2,2025,15,0,0,0,0,0,7,22,0,28,322,5,0,92.4,31.5],[563,3,2021,12,0,0,0,0,0,0,0,0,55,802,6,0,171.2,81.6],[1384,3,2024,14,0,0,0,0,0,1,-4,0,59,600,4,1,140.6,67.0],[1360,3,2021,16,0,0,0,0,0,0,0,0,30,245,4,0,78.5,37.4]],"PIT|4":[[624,0,2025,16,327,498,3322,24,7,21,61,1,1,-9,0,1,227.1,64.0],[185,0,2021,16,390,605,3740,22,10,20,5,1,0,0,0,5,218.1,58.3],[1032,0,2024,11,214,336,2482,16,5,43,155,2,0,0,0,4,172.8,48.4],[1385,0,2022,13,245,389,2404,7,9,55,237,3,0,0,0,1,149.9,35.5],[1386,1,2021,17,0,0,0,0,0,307,1200,7,74,467,3,0,300.7,94.9],[1387,1,2025,17,0,0,0,0,0,114,537,5,73,486,3,1,221.3,73.3],[1388,1,2025,16,0,0,0,0,0,211,958,6,40,333,2,0,217.1,71.8],[1151,2,2021,16,0,0,0,0,0,5,53,0,107,1161,8,2,274.4,93.4],[1389,2,2023,17,0,0,0,0,0,3,18,0,63,1140,5,0,208.8,71.1],[1326,2,2025,15,0,0,0,0,0,2,12,1,59,850,6,0,187.2,63.7],[1152,2,2021,15,0,0,0,0,0,14,96,0,59,860,2,0,166.6,56.7],[1390,2,2024,17,0,0,0,0,0,0,0,0,36,548,4,0,120.8,41.1],[1391,2,2021,16,0,0,0,0,0,2,15,0,39,277,0,0,68.2,23.2],[1153,2,2021,15,0,0,0,0,0,2,13,0,24,285,2,0,65.8,22.4],[1392,2,2024,15,0,0,0,0,0,0,0,0,24,276,2,0,63.6,21.7],[1393,3,2024,17,0,0,0,0,0,0,0,0,65,653,7,1,170.3,81.2],[1229,3,2025,17,0,0,0,0,0,9,70,1,38,222,2,0,85.2,40.6],[1394,3,2025,13,0,0,0,0,0,0,0,0,31,364,1,1,73.4,35.0],[1395,3,2021,10,0,0,0,0,0,0,0,0,19,167,0,0,35.7,17.0]],"GB|4":[[624,0,2021,16,366,531,4115,37,4,33,101,3,1,-4,0,0,333.3,100.4],[1396,0,2023,17,372,579,4159,32,11,50,247,4,0,0,0,3,319.1,89.1],[1272,1,2024,17,0,0,0,0,0,301,1329,15,36,342,1,3,293.1,95.7],[1166,1,2022,17,0,0,0,0,0,213,1121,2,59,395,5,3,248.6,86.7],[1397,1,2021,17,0,0,0,0,0,187,803,5,34,313,2,1,185.6,60.0],[1398,1,2024,17,0,0,0,0,0,103,502,4,11,48,1,0,96.0,33.0],[799,2,2021,16,0,0,0,0,0,0,0,0,123,1553,11,0,344.3,117.2],[1399,2,2023,16,0,0,0,0,0,11,119,2,64,793,8,0,217.2,74.0],[1171,2,2022,15,0,0,0,0,0,2,0,0,60,788,6,0,174.8,59.5],[1400,2,2023,17,0,0,0,0,0,0,0,0,59,674,8,0,174.4,59.4],[1401,2,2022,14,0,0,0,0,0,7,80,2,41,611,7,0,164.1,55.9],[1402,2,2023,15,1,1,14,0,0,1,1,0,39,581,4,1,119.8,40.8],[797,2,2021,11,0,0,0,0,0,1,1,0,28,375,5,0,95.6,32.6],[1170,2,2021,11,0,0,0,0,0,0,0,0,26,430,3,0,87.0,29.6],[1403,3,2024,17,0,0,0,0,0,3,6,0,50,707,7,1,163.3,77.9],[1174,3,2022,17,0,0,0,0,0,0,0,0,53,470,2,0,112.0,53.4],[1404,3,2023,11,0,0,0,0,0,0,0,0,34,352,1,0,75.2,35.9],[1405,3,2021,14,0,0,0,0,0,0,0,0,25,245,2,0,61.5,29.3]],"HOU|4":[[1406,0,2023,15,319,499,4108,23,5,39,167,3,1,0,0,4,276.0,78.7],[1407,0,2022,15,292,479,3118,17,15,32,108,2,0,0,0,3,181.5,44.0],[1051,0,2021,6,91,150,966,5,5,19,151,3,0,0,0,0,81.7,19.1],[1300,1,2024,14,0,1,0,0,0,245,1016,11,36,309,1,0,240.5,76.9],[1408,1,2022,13,0,0,0,0,0,220,939,4,30,165,1,2,166.4,53.6],[1290,1,2023,17,1,1,6,1,0,216,898,4,30,193,0,0,167.3,53.2],[1409,1,2025,16,0,0,0,0,0,196,703,2,24,208,3,0,145.1,42.4],[1241,1,2021,15,0,1,0,0,0,122,427,3,25,186,0,0,104.3,30.6],[1265,1,2025,15,0,0,0,0,0,122,506,3,13,67,0,0,88.3,27.9],[1410,2,2023,15,0,0,0,0,0,1,7,0,80,1297,8,0,260.4,88.7],[910,2,2021,16,0,0,0,0,0,2,21,0,90,1037,6,0,231.8,78.9],[1411,2,2023,10,0,0,0,0,0,11,51,0,47,709,7,0,165.0,56.2],[1412,2,2025,17,0,0,0,0,0,0,0,0,41,525,6,0,129.5,44.1],[967,2,2024,8,1,1,13,0,0,3,8,1,47,496,3,0,121.9,41.5],[1413,2,2022,15,0,0,0,0,0,3,3,0,48,548,2,0,115.1,39.2],[1414,2,2023,10,0,0,0,0,0,1,-1,0,33,567,2,0,101.6,34.6],[1415,2,2025,16,0,0,0,0,0,3,22,0,35,428,3,0,98.0,33.4],[1129,3,2025,17,0,0,0,0,0,0,0,0,82,777,3,0,177.7,84.7],[1368,3,2022,15,0,0,0,0,0,0,0,0,37,495,5,1,116.5,55.6],[1416,3,2021,8,0,0,0,0,0,0,0,0,20,178,3,0,55.8,26.6],[1417,3,2021,13,0,0,0,0,0,0,0,0,23,171,0,1,38.1,18.2]],"ATL|4":[[634,0,2021,17,375,560,3968,20,12,40,82,1,0,0,0,4,222.9,62.0],[811,0,2022,13,184,300,2219,15,9,85,438,4,0,0,0,3,196.6,51.4],[878,0,2024,14,303,453,3508,18,16,23,0,0,0,0,0,2,176.3,48.6],[1418,0,2023,15,249,388,2836,12,12,53,193,5,1,-6,0,7,177.1,45.8],[1419,1,2025,17,0,0,0,0,0,287,1478,7,79,820,4,3,370.8,125.7],[965,1,2021,16,0,1,0,0,0,153,618,6,52,548,5,0,234.6,74.7],[1420,1,2022,16,0,0,0,0,0,210,1035,3,16,139,1,0,159.4,55.6],[1234,1,2021,17,0,0,0,0,0,138,503,3,44,259,1,3,138.2,41.8],[1421,2,2024,17,0,0,0,0,0,1,-3,0,100,1271,9,0,280.8,95.6],[1259,2,2024,16,0,1,0,0,0,0,0,0,64,992,5,0,193.2,65.8],[1249,2,2021,13,0,0,0,0,0,0,0,0,66,770,4,2,163.0,55.5],[1391,2,2024,17,0,0,0,0,0,10,79,0,62,686,1,1,142.5,48.5],[1252,2,2022,16,0,0,0,0,0,2,7,0,40,533,3,1,110.0,37.5],[1248,2,2021,5,0,0,0,0,0,0,0,0,31,281,2,0,71.1,24.2],[1099,2,2022,12,0,0,0,0,0,0,0,0,13,268,2,0,51.8,17.6],[1422,2,2025,12,0,0,0,0,0,0,0,0,18,191,2,0,49.1,16.7],[1423,3,2025,17,0,0,0,0,0,0,0,0,88,928,5,0,210.8,100.5],[1229,3,2023,17,0,1,0,0,0,1,0,0,50,582,3,1,124.2,59.2],[1087,3,2021,12,0,0,0,0,0,0,0,0,26,221,3,1,64.1,30.6],[1424,3,2022,10,0,0,0,0,0,0,0,0,16,150,4,0,55.0,26.2]],"LA|4":[[586,0,2025,17,388,597,4707,46,8,29,1,0,0,0,0,3,350.4,102.4],[1425,1,2025,17,0,0,0,0,0,259,1252,10,36,281,3,2,263.3,88.7],[1281,1,2021,12,0,0,0,0,0,149,688,5,29,176,3,0,163.4,54.4],[1240,1,2021,17,0,0,0,0,0,208,845,4,21,128,1,1,146.3,45.7],[1283,1,2022,15,0,0,0,0,0,188,786,7,13,117,0,2,141.3,44.9],[1426,1,2025,17,0,0,0,0,0,145,746,6,8,36,0,0,122.2,43.4],[1312,1,2023,11,0,0,0,0,0,77,319,2,1,13,0,0,46.2,14.5],[1284,2,2021,17,0,1,0,0,0,4,18,0,145,1947,16,0,439.5,130],[1427,2,2025,16,0,0,0,0,0,10,105,1,129,1715,10,1,375.0,127.7],[799,2,2025,14,0,0,0,0,0,0,0,0,60,789,14,0,222.9,75.9],[1392,2,2021,17,0,0,0,0,0,2,20,0,50,802,6,0,168.2,57.3],[1057,2,2021,9,0,0,0,0,0,8,46,1,45,556,4,0,137.2,46.7],[1162,2,2024,17,0,0,0,0,0,0,0,0,31,505,7,0,123.5,42.0],[1428,2,2023,14,0,0,0,0,0,5,31,0,39,483,3,0,112.4,38.3],[992,2,2021,8,0,0,0,0,0,0,0,0,27,305,5,0,87.5,29.8],[1287,3,2022,16,0,0,0,0,0,0,0,0,72,620,3,0,152.0,72.5],[1429,3,2025,14,0,0,0,0,0,0,0,0,43,408,8,1,129.8,61.9],[1430,3,2025,15,0,0,0,0,0,0,0,0,24,208,3,0,62.8,29.9],[1431,3,2025,11,0,0,0,0,0,1,0,0,11,231,3,0,52.1,24.8]],"LAC|4":[[1102,0,2021,17,443,672,5014,38,15,63,302,3,0,0,0,1,380.8,107.3],[1103,1,2022,17,0,0,0,0,0,204,915,13,107,722,5,3,372.7,122.0],[1081,1,2024,13,0,0,0,0,0,195,905,9,32,153,0,0,191.8,64.2],[1432,1,2025,9,0,0,0,0,0,124,545,4,32,192,1,0,135.7,44.3],[1433,1,2025,13,0,0,0,0,0,155,643,3,16,136,1,0,117.9,37.3],[1106,1,2021,14,0,0,0,0,0,68,364,2,22,178,0,1,86.2,30.2],[1104,1,2022,12,0,0,0,0,0,69,287,2,14,101,0,0,64.8,20.6],[929,2,2023,13,1,2,49,1,0,2,6,0,108,1243,7,1,278.9,94.9],[1108,2,2021,16,0,0,0,0,0,0,0,0,76,1146,9,0,246.6,84.0],[1434,2,2024,16,0,0,0,0,0,0,0,0,82,1149,7,0,240.9,82.0],[1435,2,2024,15,0,0,0,0,0,3,6,0,55,711,8,0,174.7,59.5],[1436,2,2022,16,0,0,0,0,0,1,4,0,72,769,3,0,169.3,57.6],[1437,2,2022,17,0,0,0,0,0,2,-15,0,46,538,3,1,114.3,38.9],[1109,2,2021,16,0,0,0,0,0,7,34,0,31,448,3,0,97.2,33.1],[1438,2,2025,16,0,0,0,0,0,2,10,0,30,324,1,0,69.4,23.6],[1288,3,2022,15,0,0,0,0,0,1,0,0,58,555,4,0,139.5,66.5],[614,3,2021,16,0,0,0,0,0,0,0,0,48,564,4,0,132.4,63.1],[1439,3,2025,15,0,0,0,0,0,0,0,0,49,664,3,1,131.4,62.7],[1331,3,2024,15,0,0,0,0,0,0,0,0,50,481,2,0,110.1,52.5]],"BUF|4":[[1289,0,2021,17,409,646,4407,36,15,122,763,6,0,0,0,3,402.6,110.3],[1440,1,2025,17,0,0,0,0,0,309,1621,12,33,291,2,3,302.2,104.0],[1290,1,2021,17,0,0,0,0,0,188,870,7,40,228,1,0,197.8,66.0],[1441,1,2024,17,0,0,0,0,0,113,442,3,17,189,3,0,116.1,36.2],[1442,1,2025,17,0,0,0,0,0,50,200,3,24,263,2,0,100.3,32.0],[1291,1,2021,13,0,0,0,0,0,96,345,4,23,197,1,1,105.2,31.9],[1043,1,2023,15,0,0,0,0,0,79,300,4,17,119,0,0,82.9,25.5],[967,2,2022,16,0,0,0,0,0,1,-3,0,108,1429,11,0,316.6,107.8],[1443,2,2024,15,0,0,0,0,0,2,4,0,76,821,4,0,182.5,62.1],[1293,2,2022,15,0,0,0,0,0,0,0,0,48,836,7,1,171.6,58.4],[937,2,2021,16,0,1,0,0,0,0,0,0,82,693,1,0,159.3,54.2],[777,2,2021,14,0,0,0,0,0,2,31,0,42,626,4,0,131.7,44.8],[1294,2,2022,15,0,0,0,0,0,9,55,1,42,423,4,0,119.8,40.8],[1444,2,2024,13,0,0,0,0,0,1,9,0,29,556,4,0,111.5,38.0],[1445,2,2024,17,0,0,0,0,0,0,0,0,31,378,5,0,98.8,33.6],[1296,3,2021,15,0,0,0,0,0,0,4,0,49,587,9,0,164.1,78.3],[1446,3,2023,16,0,0,0,0,0,0,0,0,73,673,2,1,150.3,71.7],[1447,3,2025,13,0,0,0,0,0,0,0,0,16,187,3,0,52.7,25.1]],"CHI|4":[[1448,0,2025,17,330,568,3942,27,7,77,388,3,2,22,1,1,318.7,84.1],[1449,0,2022,15,192,318,2242,17,11,160,1143,8,0,0,0,2,296.0,77.3],[1024,0,2021,8,149,236,1515,8,9,16,76,0,0,0,0,1,84.2,18.8],[1114,1,2025,16,0,0,0,0,0,223,1087,9,34,299,1,2,228.6,77.7],[1256,1,2021,13,0,1,0,0,1,225,849,7,42,301,0,1,195.0,59.7],[1450,1,2025,17,0,0,0,0,0,169,783,5,18,164,0,0,146.7,49.2],[1451,1,2022,13,0,0,0,0,0,129,731,4,9,57,1,0,117.8,43.8],[1452,1,2023,15,0,0,0,0,0,81,352,2,34,209,0,0,102.1,33.2],[1363,1,2023,9,0,0,0,0,0,109,425,4,11,77,1,0,91.2,28.1],[1236,2,2023,17,0,0,0,0,0,4,21,1,96,1364,8,1,286.5,97.5],[1259,2,2021,17,0,0,0,0,0,6,32,1,81,1055,4,0,219.7,74.8],[929,2,2024,15,0,1,0,0,1,0,0,0,70,744,7,0,184.4,62.8],[1453,2,2025,12,0,0,0,0,0,0,0,0,44,661,6,0,146.1,49.7],[1454,2,2025,15,0,0,0,0,0,6,37,0,47,652,2,0,127.9,43.5],[1065,2,2021,12,0,0,0,0,0,0,0,0,38,410,1,0,87.0,29.6],[1252,2,2025,14,0,0,0,0,0,4,25,0,39,313,2,0,84.8,28.9],[1099,2,2021,11,0,0,0,0,0,0,0,0,26,329,1,0,66.9,22.8],[1261,3,2023,16,0,0,0,0,0,3,2,0,73,719,6,0,181.1,86.4],[1455,3,2025,16,0,0,0,0,0,1,-2,0,58,713,6,0,165.1,78.7],[685,3,2021,11,0,0,0,0,0,0,0,0,14,167,3,0,50.7,24.2]],"ARI|4":[[1093,0,2021,14,333,481,3787,24,10,88,423,5,0,7,0,0,300.5,87.7],[1175,0,2025,14,315,485,3366,23,8,38,168,1,0,0,0,4,227.4,63.5],[1456,0,2023,8,167,266,1569,8,5,47,258,3,0,0,0,4,124.6,30.4],[1147,1,2024,16,0,0,0,0,0,236,1094,8,47,414,1,1,253.8,84.4],[1096,1,2021,12,0,0,0,0,0,116,592,2,43,311,0,1,143.3,49.4],[1457,1,2025,13,0,0,0,0,0,92,333,1,33,267,0,0,99.0,30.0],[1458,1,2022,10,0,0,0,0,0,70,299,2,24,184,0,0,86.3,27.9],[1459,1,2025,12,0,0,0,0,0,82,269,4,22,160,1,1,92.9,27.4],[1460,1,2023,11,0,0,0,0,0,58,284,2,21,119,0,0,73.3,24.9],[1461,2,2025,17,0,0,0,0,0,0,0,0,78,1006,7,0,220.6,75.1],[1098,2,2021,17,1,1,33,0,0,1,11,0,77,982,5,0,207.6,70.7],[1462,2,2024,17,0,0,0,0,0,0,0,0,62,885,8,1,196.5,66.9],[1028,2,2021,16,0,0,0,0,0,0,0,0,54,848,3,0,156.8,53.4],[1084,2,2022,12,0,0,0,0,0,1,1,0,67,709,3,0,156.0,53.1],[957,2,2022,9,0,0,0,0,0,0,0,0,64,717,3,1,151.7,51.7],[1463,2,2022,16,0,0,0,0,0,7,44,0,52,467,2,0,115.1,39.2],[1464,2,2021,14,0,0,0,0,0,18,76,0,54,435,1,0,111.1,37.8],[1465,3,2025,17,0,0,0,0,0,0,0,0,126,1239,11,0,315.9,130],[871,3,2021,11,0,0,0,0,0,1,4,0,56,574,3,0,131.8,62.9],[1466,3,2025,17,0,0,0,0,0,0,0,0,30,301,0,1,58.1,27.7],[1467,3,2021,5,0,0,0,0,0,0,0,0,16,193,1,0,41.3,19.7]],"TEN|4":[[1071,0,2021,17,357,531,3734,21,14,55,270,7,0,0,0,4,268.4,74.3],[1468,0,2025,17,323,540,3169,15,7,39,159,2,0,0,0,7,186.7,45.4],[1469,0,2024,12,190,301,2091,13,12,45,183,0,0,0,0,6,119.9,28.9],[1146,0,2024,8,146,228,1530,9,9,25,106,1,0,0,0,1,95.8,23.2],[1223,1,2022,16,2,2,4,1,0,349,1538,13,33,398,0,3,302.8,98.8],[1124,1,2024,16,0,0,0,0,0,260,1079,5,41,238,0,2,200.7,64.0],[1470,1,2023,17,0,0,0,0,0,100,453,2,52,385,1,0,153.8,50.6],[1363,1,2021,9,0,0,0,0,0,133,566,3,9,123,0,1,93.9,30.1],[1471,1,2021,8,0,0,0,0,0,56,350,2,19,87,0,1,72.7,27.1],[1472,1,2021,13,0,0,0,0,0,41,156,0,28,240,1,0,73.6,23.2],[957,2,2023,17,0,1,0,0,0,2,9,0,75,1057,7,0,223.6,76.1],[1248,2,2024,17,0,0,0,0,0,8,55,1,64,1017,4,1,199.2,67.8],[1224,2,2021,13,0,2,0,0,0,2,10,0,63,869,5,0,180.9,61.6],[1473,2,2024,14,0,0,0,0,0,0,0,0,32,497,9,0,135.7,46.2],[1474,2,2025,17,0,0,0,0,0,11,18,0,48,423,4,0,128.1,43.6],[1057,2,2022,17,0,0,0,0,0,0,0,0,53,527,2,0,117.7,40.1],[1475,2,2025,16,0,0,0,0,0,0,0,0,41,515,4,0,116.5,39.7],[1476,2,2022,11,0,0,0,0,0,4,47,0,33,444,1,0,88.1,30.0],[1477,3,2025,17,0,0,0,0,0,0,0,0,56,560,2,0,124.0,59.1],[1253,3,2022,17,0,0,0,0,0,0,0,0,41,444,2,0,97.4,46.4],[1478,3,2025,16,0,0,0,0,0,0,0,0,44,357,2,0,91.7,43.7],[1230,3,2021,15,0,0,0,0,0,0,0,0,34,291,2,1,73.1,34.9]],"NYG|4":[[1132,0,2022,16,317,472,3205,15,5,120,708,7,0,0,0,3,289.0,81.0],[1479,0,2025,14,216,339,2272,15,5,86,487,9,0,0,0,2,241.6,66.1],[1480,0,2023,9,114,178,1101,8,3,36,195,1,0,0,0,1,93.5,25.1],[1051,0,2023,10,116,180,1341,5,3,38,197,0,0,0,0,0,87.3,23.5],[1133,1,2022,16,0,0,0,0,0,295,1312,10,57,338,0,0,284.0,93.0],[1481,1,2024,17,0,0,0,0,0,192,839,5,38,284,1,2,182.3,59.4],[1313,1,2021,16,0,0,0,0,0,145,593,2,40,268,1,0,144.1,45.6],[1482,1,2025,8,0,0,0,0,0,101,410,5,24,207,2,1,127.7,40.6],[1290,1,2025,17,0,0,0,0,0,119,437,5,18,151,0,0,108.8,32.8],[1336,1,2022,17,0,0,0,0,0,54,220,1,20,118,0,0,59.8,19.0],[1483,2,2024,15,0,1,0,0,0,5,2,0,109,1204,7,0,273.6,93.2],[1484,2,2025,16,0,0,0,0,0,3,5,0,92,1014,4,0,217.9,74.2],[1138,2,2023,17,0,0,0,0,0,0,0,0,50,770,4,0,151.0,51.4],[1485,2,2022,16,0,0,0,0,0,2,6,0,57,569,4,0,138.5,47.2],[1486,2,2022,8,0,0,0,0,0,0,0,0,33,351,4,1,92.1,31.4],[1117,2,2021,14,0,0,0,0,0,0,0,0,37,521,0,0,89.1,30.3],[1487,2,2021,9,1,3,19,0,0,3,6,0,39,420,0,0,82.4,28.0],[1137,2,2021,7,0,0,0,0,0,1,-9,0,36,366,1,0,77.7,26.5],[1488,3,2025,15,0,0,0,0,0,0,0,0,45,528,5,0,127.8,60.9],[1278,3,2023,12,0,0,0,0,0,0,0,0,52,552,1,0,113.2,54.0],[1142,3,2021,15,0,0,0,0,0,1,-3,0,46,408,3,1,102.5,48.9],[1489,3,2022,11,0,0,0,0,0,1,2,1,30,268,2,1,75.0,35.8]],"NE|4":[[1490,0,2025,17,354,492,4394,31,8,103,450,4,1,2,0,3,352.0,107.4],[1491,0,2021,17,352,521,3801,22,13,44,129,0,0,0,0,3,224.9,63.5],[1492,1,2022,17,0,0,0,0,0,210,1040,5,69,421,1,1,249.1,84.9],[1493,1,2025,17,0,0,0,0,0,180,911,9,35,221,1,1,206.2,71.2],[1242,1,2021,15,0,0,0,0,0,202,929,15,18,132,0,2,210.1,69.9],[1123,1,2023,17,0,0,0,0,0,184,642,3,51,313,2,1,174.5,51.6],[1494,1,2021,16,0,0,0,0,0,44,226,1,41,405,2,0,124.1,41.5],[1204,1,2024,17,0,0,0,0,0,120,538,1,23,206,0,0,103.4,34.1],[967,2,2025,17,0,0,0,0,0,0,0,0,85,1013,4,0,210.3,71.6],[1243,2,2021,16,2,2,45,0,0,1,9,0,83,866,2,1,186.3,63.4],[1341,2,2021,17,1,1,25,1,0,12,125,0,55,800,5,1,180.5,61.5],[1495,2,2024,16,0,0,0,0,0,3,16,0,66,621,3,0,147.7,50.3],[1496,2,2025,14,0,0,0,0,0,0,0,0,33,551,6,0,124.1,42.3],[1445,2,2025,14,0,0,0,0,0,1,4,0,46,550,2,0,113.4,38.6],[868,2,2021,14,0,0,0,0,0,3,11,0,37,473,3,0,103.4,35.2],[1078,2,2022,12,0,0,0,0,0,0,0,0,31,539,3,0,102.9,35.0],[1111,3,2025,17,0,0,0,0,0,0,0,0,60,768,7,0,178.8,85.3],[1253,3,2024,17,0,0,0,0,0,0,0,0,45,476,3,1,108.6,51.8],[1229,3,2021,16,0,0,0,0,0,9,40,0,28,294,1,0,67.4,32.1],[1375,3,2023,15,0,0,0,0,0,0,0,0,29,244,2,0,65.4,31.2]],"SEA|4":[[856,0,2022,17,399,572,4282,30,11,68,366,1,0,0,0,4,303.9,89.0],[1032,0,2021,14,259,400,3113,25,6,43,183,2,0,0,0,1,242.8,70.7],[1196,0,2025,17,323,477,4048,25,14,35,95,0,0,0,0,6,235.4,68.7],[1497,1,2022,15,0,0,0,0,0,228,1050,9,27,165,0,0,202.5,67.5],[1498,1,2024,17,0,0,0,0,0,135,569,8,42,340,1,0,186.9,60.2],[1325,1,2021,10,0,0,0,0,0,119,749,6,6,48,0,0,121.7,47.0],[1499,1,2021,14,0,0,0,0,0,21,177,1,16,161,0,0,61.8,22.8],[1082,1,2021,11,0,0,0,0,0,108,411,2,9,87,0,1,68.8,20.5],[1500,1,2021,17,0,0,0,0,0,33,138,2,21,133,0,0,60.1,19.4],[1501,2,2025,17,0,0,0,0,0,7,36,0,119,1793,10,1,359.9,122.5],[1326,2,2021,17,0,0,0,0,0,1,6,0,75,967,12,0,244.3,83.2],[1036,2,2021,16,0,0,0,0,0,2,9,0,73,1175,8,0,241.4,82.2],[1284,2,2025,16,0,1,0,0,1,0,0,0,47,593,2,1,116.3,39.6],[1340,2,2022,13,0,0,0,0,0,2,5,0,27,387,4,0,90.2,30.7],[1502,2,2021,17,0,0,0,0,0,5,32,0,25,343,4,0,86.5,29.5],[1503,2,2025,8,0,0,0,0,0,0,0,0,13,161,5,0,65.1,22.2],[1504,2,2023,14,0,0,0,0,0,1,3,1,19,196,2,0,56.9,19.4],[1505,3,2025,17,0,0,0,0,0,10,14,1,52,519,6,0,147.3,70.2],[1320,3,2022,17,0,0,0,0,0,0,0,0,50,486,4,0,122.6,58.5],[1288,3,2021,15,0,0,0,0,0,3,20,0,48,478,4,2,117.8,56.2],[1331,3,2022,15,0,0,0,0,0,0,0,0,34,349,3,0,86.9,41.4]],"JAX|4":[[1506,0,2025,17,341,560,4007,29,12,82,359,9,0,0,0,3,338.2,91.1],[1491,0,2024,10,171,262,1672,8,8,28,92,1,0,0,0,2,96.1,23.5],[1507,1,2023,17,0,0,0,0,0,267,1008,11,58,476,1,0,282.4,88.1],[1216,1,2021,14,0,0,0,0,0,164,767,8,31,222,0,2,173.9,58.3],[1508,1,2024,16,0,0,0,0,0,168,766,7,7,54,0,1,129.0,43.1],[1509,1,2025,15,0,0,0,0,0,83,307,5,10,79,2,1,88.6,27.1],[1510,1,2022,14,0,0,0,0,0,46,194,2,20,126,1,0,70.0,22.6],[1356,1,2021,13,0,0,0,0,0,43,137,1,13,114,1,0,50.1,14.7],[1511,2,2024,17,0,0,0,0,0,6,48,0,87,1282,10,0,284.0,96.7],[1098,2,2022,17,0,1,0,0,0,5,11,0,84,1108,8,1,241.9,82.4],[1248,2,2023,17,0,0,0,0,0,9,23,0,76,1016,8,0,229.9,78.3],[1292,2,2022,16,0,0,0,0,0,4,18,0,82,823,5,0,198.1,67.4],[1512,2,2025,16,0,0,0,0,0,7,0,0,58,847,5,0,184.7,62.9],[1029,2,2021,17,0,0,0,0,0,0,0,0,73,832,4,0,180.2,61.4],[1220,2,2021,16,0,0,0,0,0,11,41,0,63,619,0,1,127.0,43.2],[1243,2,2025,9,0,0,0,0,0,5,13,0,42,483,3,1,107.6,36.6],[1142,3,2023,17,0,0,0,0,0,0,0,0,114,963,4,2,230.3,109.8],[1513,3,2025,12,0,0,0,0,0,0,0,0,46,540,3,0,118.0,56.3],[1100,3,2021,8,0,0,0,0,0,0,0,0,28,324,0,1,60.4,28.8],[1222,3,2021,7,0,0,0,0,0,0,0,0,24,244,0,0,50.4,24.0]],"MIN|4":[[1196,0,2024,17,361,545,4319,35,12,67,212,1,0,0,0,4,308.0,89.1],[878,0,2021,16,372,561,4221,33,7,29,115,1,0,0,0,2,300.3,87.2],[1514,0,2025,10,140,243,1632,11,12,37,181,4,0,0,0,2,125.4,26.8],[1187,0,2025,5,110,169,1216,6,5,11,57,0,0,0,0,0,70.3,18.4],[1166,1,2024,17,0,0,0,0,0,255,1138,5,51,408,2,3,241.6,79.3],[1345,1,2022,17,0,0,0,0,0,264,1173,8,39,295,2,4,237.8,77.9],[1515,1,2025,16,0,0,0,0,0,159,758,6,14,51,0,1,128.9,44.1],[1346,1,2023,16,0,0,0,0,0,180,700,0,30,192,3,2,133.2,40.6],[1516,1,2023,16,0,0,0,0,0,102,461,3,21,159,0,0,101.0,33.4],[1283,1,2024,11,0,0,0,0,0,64,297,1,10,52,2,0,62.9,21.1],[1348,2,2022,17,2,2,34,0,0,4,24,1,128,1809,8,0,368.7,125.5],[1517,2,2023,17,0,0,0,0,0,1,2,0,70,911,10,0,221.3,75.3],[1347,2,2021,13,0,0,0,0,0,1,2,0,67,726,10,0,199.8,68.0],[1518,2,2021,17,0,0,0,0,0,1,10,0,50,655,7,0,158.5,54.0],[1519,2,2024,15,0,0,0,0,0,3,-4,0,28,414,6,0,105.0,35.8],[1520,2,2023,17,0,0,0,0,0,5,17,0,29,324,1,0,69.1,23.5],[1121,3,2023,15,0,0,0,0,0,0,0,0,95,960,5,1,219.0,104.4],[1353,3,2021,17,0,0,0,0,0,0,0,0,61,593,3,0,138.3,66.0],[1521,3,2024,12,0,0,0,0,0,0,0,0,22,258,3,0,65.8,31.4],[1352,3,2022,8,0,0,0,0,0,0,0,0,25,182,2,0,55.2,26.3]],"SF|4":[[1522,0,2023,16,308,444,4280,31,11,39,144,2,0,0,0,2,295.6,90.6],[1332,0,2021,15,301,441,3810,20,12,38,51,3,0,0,0,3,227.5,66.6],[1491,0,2025,11,201,289,2151,13,6,36,60,0,0,0,0,2,130.0,39.8],[1233,1,2023,16,0,0,0,0,0,272,1459,14,67,564,7,2,391.3,130],[1523,1,2021,11,0,0,0,0,0,207,963,5,19,137,1,0,165.0,55.6],[1515,1,2024,12,0,0,0,0,0,153,789,3,11,91,0,1,115.0,41.4],[1524,1,2024,16,0,0,0,0,0,84,420,4,15,152,0,0,96.2,33.0],[1337,1,2022,8,0,0,0,0,0,92,468,2,10,91,0,2,73.9,26.2],[828,1,2021,15,0,0,0,0,0,8,22,1,30,296,1,0,73.8,23.6],[1338,2,2021,16,1,2,24,1,0,59,365,8,77,1405,6,2,339.0,115.4],[1339,2,2023,16,0,0,0,0,0,0,0,0,75,1342,7,1,249.2,84.8],[1525,2,2024,15,0,0,0,0,0,0,0,0,77,975,6,0,210.5,71.7],[1526,2,2024,11,0,1,0,0,0,3,45,0,31,400,3,0,93.5,31.8],[1341,2,2025,14,0,0,0,0,0,0,0,0,37,551,0,0,92.1,31.4],[1162,2,2025,14,0,0,0,0,0,1,6,0,22,276,1,0,58.2,19.8],[1391,2,2022,17,0,0,0,0,0,4,78,1,14,243,1,0,58.1,19.8],[1344,3,2024,15,0,0,0,0,0,0,0,0,78,1106,8,0,236.6,112.8],[1527,3,2025,10,0,0,0,0,0,0,0,0,34,293,5,0,93.3,44.5]],"PHI|4":[[1188,0,2022,15,306,460,3701,22,6,165,760,13,0,0,0,2,378.0,108.1],[1133,1,2024,16,0,0,0,0,0,345,2005,13,33,278,2,1,355.3,124.9],[1189,1,2022,17,0,0,0,0,0,259,1269,11,20,78,0,2,216.7,74.0],[1114,1,2023,16,0,0,0,0,0,229,1049,5,39,214,1,1,199.3,66.3],[1387,1,2021,16,0,0,0,0,0,68,291,5,33,253,1,1,123.4,40.0],[1528,1,2021,11,0,0,0,0,0,87,373,7,13,83,0,1,98.6,31.9],[1191,1,2021,7,0,0,0,0,0,86,406,3,2,19,0,0,62.5,21.4],[1224,2,2022,17,0,0,0,0,0,0,0,0,88,1496,11,2,299.6,102.0],[1529,2,2022,17,0,0,0,0,0,0,0,0,95,1196,7,0,256.6,87.4],[1530,2,2021,17,0,0,0,0,0,1,3,0,43,647,1,0,116.0,39.5],[1194,2,2021,17,0,0,0,0,0,10,32,0,33,299,2,0,78.1,26.6],[1531,2,2025,15,0,0,0,0,0,0,0,0,18,262,1,0,50.2,17.1],[1195,3,2025,15,0,0,0,0,0,0,0,0,60,591,11,0,185.1,88.3],[1532,3,2024,15,0,0,0,0,0,0,0,0,24,298,1,0,59.8,28.5],[871,3,2021,6,0,0,0,0,0,0,0,0,18,189,2,0,48.9,23.3]],"NYJ|4":[[624,0,2024,17,368,584,3897,28,11,22,107,0,0,0,0,2,256.6,69.5],[1449,0,2025,9,128,204,1259,7,1,71,383,4,0,0,0,3,142.7,38.2],[1533,0,2021,13,213,383,2334,9,11,29,185,4,0,0,0,1,151.9,30.3],[1534,1,2023,17,0,0,0,0,0,223,994,5,76,591,4,0,290.5,95.1],[1457,1,2021,14,0,0,0,0,0,147,639,4,36,325,0,1,154.4,50.2],[1442,1,2021,15,0,0,0,0,0,61,238,2,34,372,2,1,117.0,37.2],[1535,1,2024,17,0,0,0,0,0,92,334,2,19,148,1,0,85.2,25.6],[1536,1,2025,16,0,0,0,0,0,43,236,1,21,186,0,0,71.2,24.7],[1459,1,2022,7,0,0,0,0,0,85,300,1,13,100,0,0,59.0,16.9],[1537,2,2024,17,0,0,0,0,0,2,5,0,101,1104,7,2,251.9,85.8],[799,2,2024,11,0,0,0,0,0,0,0,0,67,854,7,0,196.4,66.9],[1538,2,2021,11,0,0,0,0,0,5,54,1,43,538,5,0,138.2,47.1],[1171,2,2024,12,0,1,0,0,0,0,0,0,37,530,6,0,126.0,42.9],[1200,2,2021,16,0,0,0,0,0,7,40,2,46,431,2,1,121.1,41.2],[884,2,2021,12,0,0,0,0,0,0,0,0,51,447,2,1,109.7,37.4],[1225,2,2021,9,0,0,0,0,0,0,0,0,34,492,4,1,105.2,35.8],[1221,2,2021,14,0,1,0,0,0,0,0,0,28,449,1,0,78.9,26.9],[1353,3,2022,17,0,0,0,0,0,2,3,0,58,552,3,0,131.5,62.7],[1539,3,2025,13,0,0,0,0,0,0,0,0,44,369,1,0,88.9,42.4],[1202,3,2021,14,0,0,0,0,0,0,0,0,27,261,2,0,65.1,31.0],[1307,3,2022,14,0,0,0,0,0,0,0,0,21,232,2,0,56.2,26.8]],"IND|4":[[1187,0,2021,17,322,516,3563,27,7,57,215,1,0,0,0,5,258.0,71.0],[1132,0,2025,13,261,384,3101,19,8,45,164,5,0,0,0,3,226.4,66.7],[1214,0,2023,16,305,490,3305,15,9,34,100,3,0,0,0,5,196.2,50.5],[634,0,2022,12,309,461,3057,14,13,27,70,1,0,0,0,5,155.3,41.3],[1176,1,2021,17,0,0,0,0,0,332,1811,18,40,360,2,2,373.1,128.4],[1291,1,2023,14,0,0,0,0,0,183,794,5,27,192,2,0,169.6,55.1],[1177,1,2021,17,0,0,0,0,0,56,276,2,40,310,1,0,116.6,38.9],[1540,1,2022,12,0,0,0,0,0,68,236,1,30,209,1,1,84.5,25.5],[1541,1,2024,15,0,0,0,0,0,56,159,2,16,99,0,0,53.8,14.8],[1182,2,2023,16,0,0,0,0,0,0,0,0,109,1152,4,0,252.2,85.9],[1542,2,2024,14,0,0,0,0,0,1,12,0,72,803,5,0,183.5,62.5],[1543,2,2025,15,0,0,0,0,0,0,0,0,47,1003,6,0,183.3,62.4],[1544,2,2022,17,0,0,0,0,0,5,58,0,63,623,3,0,149.1,50.8],[1180,2,2021,16,0,0,0,0,0,2,21,0,38,384,3,1,94.5,32.2],[893,2,2021,10,0,0,0,0,0,0,0,0,23,331,3,0,74.1,25.2],[1545,2,2024,17,1,1,24,0,0,4,6,0,23,312,0,1,53.8,18.3],[1546,2,2021,16,0,0,0,0,0,3,32,0,13,173,2,0,45.5,15.5],[1547,3,2025,17,0,1,0,0,0,6,8,1,76,817,4,0,188.5,89.9],[1548,3,2021,17,0,0,0,0,0,0,0,0,24,316,4,0,79.6,38.0],[1185,3,2021,15,0,0,0,0,0,0,0,0,29,302,3,0,79.2,37.8],[1549,3,2022,12,0,0,0,0,0,0,0,0,25,312,3,0,74.2,35.4]],"KC|4":[[1157,0,2022,17,435,648,5250,41,12,61,358,4,1,6,0,0,417.4,120.4],[1550,1,2023,14,0,0,0,0,0,205,935,7,44,244,2,1,213.9,70.9],[966,1,2022,17,0,0,0,0,0,72,291,1,56,512,9,1,196.3,63.1],[1551,1,2021,17,0,0,0,0,0,144,558,6,47,452,2,0,196.0,61.5],[1158,1,2024,13,0,0,0,0,0,200,728,7,23,176,0,0,155.4,46.0],[1159,1,2021,10,0,0,0,0,0,119,517,4,19,129,2,2,117.6,38.2],[1207,1,2024,17,0,0,0,0,0,20,92,1,28,322,1,0,81.4,26.6],[1160,2,2021,17,0,0,0,0,0,9,96,0,111,1239,9,1,296.5,101.0],[1552,2,2023,16,0,0,0,0,0,1,-3,0,79,938,7,1,212.5,72.4],[1553,2,2024,16,0,0,0,0,0,20,104,3,59,638,6,0,187.2,63.7],[1150,2,2022,16,0,0,0,0,0,0,0,0,78,933,3,2,185.3,63.1],[1161,2,2021,17,0,0,0,0,0,8,46,0,59,693,2,2,140.9,48.0],[1084,2,2025,16,0,0,0,0,0,0,0,0,49,587,5,0,137.7,46.9],[1554,2,2021,16,0,0,0,0,0,0,0,0,42,568,5,0,128.8,43.9],[1170,2,2022,17,0,0,0,0,0,1,-3,0,42,687,2,0,122.4,41.7],[854,3,2022,17,0,0,0,0,0,2,5,0,110,1338,12,1,316.3,130],[1555,3,2024,16,0,0,0,0,0,1,-4,0,40,437,5,0,113.3,54.0]],"BAL|4":[[1080,0,2024,17,316,474,4172,41,4,139,915,4,0,0,0,5,430.4,128.6],[1556,0,2021,7,122,188,1081,3,4,47,294,2,0,0,0,3,82.6,19.7],[1223,1,2024,17,0,0,0,0,0,325,1921,16,19,193,2,1,336.4,119.4],[1083,1,2023,17,0,0,0,0,0,198,810,13,12,180,0,2,187.0,59.2],[803,1,2021,16,0,0,0,0,0,133,576,5,34,190,1,0,146.6,47.6],[1557,1,2024,15,0,0,0,0,0,47,228,1,42,383,3,0,127.1,42.1],[1095,1,2022,12,0,0,0,0,0,109,482,4,17,89,1,0,104.1,34.1],[1043,1,2021,14,0,0,0,0,0,119,501,6,10,75,0,0,103.6,33.2],[1558,2,2025,17,0,0,0,0,0,10,62,1,86,1211,5,3,243.3,82.8],[1084,2,2021,16,0,0,0,0,0,1,5,0,91,1008,6,0,228.3,77.7],[1559,2,2024,16,0,0,0,0,0,0,0,0,45,756,9,0,174.6,59.4],[1560,2,2022,14,0,0,0,0,0,12,84,1,37,407,3,0,116.1,39.5],[992,2,2023,14,0,0,0,0,0,0,0,0,35,565,3,1,107.5,36.6],[1162,2,2022,16,0,0,0,0,0,0,0,0,48,458,2,1,103.8,35.3],[868,2,2023,16,0,0,0,0,0,0,0,0,35,381,4,0,97.1,33.1],[1056,2,2021,11,0,0,0,0,0,0,0,0,27,394,1,1,70.4,24.0],[1086,3,2021,17,0,0,0,0,0,1,0,0,107,1361,9,0,301.1,130],[1561,3,2024,15,0,0,0,0,0,0,0,0,42,477,6,1,123.7,59.0],[1521,3,2022,12,0,0,0,0,0,0,0,0,14,149,2,0,40.9,19.5],[1562,3,2025,13,0,0,0,0,0,0,0,0,10,142,2,0,36.2,17.3]],"MIA|4":[[1369,0,2023,17,388,560,4624,29,14,35,74,0,0,0,0,5,270.4,79.7],[1175,0,2021,10,141,225,1283,5,4,19,70,1,0,0,0,3,72.3,15.9],[1563,1,2025,16,0,0,0,0,0,238,1350,8,67,488,4,0,322.8,113.4],[1335,1,2023,15,0,0,0,0,0,209,1012,18,25,175,3,1,267.7,90.2],[1371,1,2021,17,0,0,0,0,0,173,612,3,49,234,4,1,173.6,51.9],[1337,1,2022,8,0,0,0,0,0,84,392,3,12,94,1,0,84.6,28.4],[1005,1,2021,5,0,0,0,0,0,71,330,3,4,41,0,0,59.1,19.9],[1564,1,2025,9,0,0,0,0,0,70,288,2,5,44,0,1,48.2,15.1],[1160,2,2023,16,0,0,0,0,0,6,15,0,119,1799,13,1,376.4,128.2],[1565,2,2022,17,0,0,0,0,0,3,26,0,75,1356,8,1,259.2,88.3],[1566,2,2025,17,0,0,0,0,0,17,110,1,46,317,3,1,116.7,39.7],[1078,2,2021,9,0,0,0,0,0,0,0,0,40,515,2,0,103.5,35.2],[1567,2,2022,16,0,0,0,0,0,0,0,0,30,417,2,0,83.7,28.5],[1568,2,2023,11,0,0,0,0,0,0,0,0,22,296,3,0,69.6,23.7],[1445,2,2021,15,0,0,0,0,0,0,0,0,14,223,4,0,60.3,20.5],[1200,2,2023,16,0,0,0,0,0,1,11,0,27,238,1,0,57.9,19.7],[1229,3,2024,17,0,0,0,0,0,2,-1,0,88,884,8,1,222.3,106.0],[1375,3,2021,17,0,1,0,0,0,0,0,0,73,780,2,0,165.0,78.7],[1278,3,2025,9,0,0,0,0,0,1,4,0,24,283,6,0,88.7,42.3],[1376,3,2023,13,0,0,0,0,0,0,0,0,35,366,0,0,71.6,34.1]],"DEN|4":[[1569,0,2024,17,376,567,3775,29,12,92,430,4,1,2,1,0,317.2,88.6],[1032,0,2023,15,297,447,3070,26,8,80,341,3,0,0,0,5,256.9,73.6],[962,0,2021,14,285,426,3052,18,7,30,106,2,0,0,0,1,202.7,57.9],[1570,1,2021,17,0,0,0,0,0,203,903,4,43,316,3,1,204.9,67.3],[928,1,2021,16,0,0,0,0,0,203,918,8,28,213,2,3,195.1,64.5],[1571,1,2025,17,0,1,0,0,0,146,540,7,47,356,5,1,206.6,64.1],[1043,1,2022,12,0,0,0,0,0,160,703,5,26,124,0,0,140.7,46.0],[1081,1,2025,10,0,0,0,0,0,153,772,4,11,37,0,0,115.9,41.1],[1207,1,2023,17,0,0,0,0,0,53,238,1,50,455,0,2,121.3,39.7],[1314,2,2024,16,2,2,30,1,0,0,0,0,81,1081,8,1,240.3,81.8],[1316,2,2022,15,0,0,0,0,0,4,40,0,67,972,6,0,204.2,69.5],[1572,2,2025,17,0,0,0,0,0,5,12,0,65,709,6,1,177.1,60.3],[1315,2,2021,16,0,0,0,0,0,0,0,0,53,734,5,0,156.4,53.3],[1573,2,2024,17,0,0,0,0,0,13,42,0,39,503,6,0,129.5,44.1],[1574,2,2024,13,0,0,0,0,0,0,0,0,41,475,3,0,106.5,36.3],[1575,2,2025,13,0,0,0,0,0,0,0,0,31,378,1,0,74.8,25.5],[1576,2,2023,10,0,0,0,0,0,0,0,0,19,284,4,0,73.4,25.0],[1320,3,2021,16,0,0,0,0,0,0,0,0,68,670,4,0,159.0,75.8],[1142,3,2025,16,0,0,0,0,0,1,7,0,50,461,1,0,102.8,49.0],[1577,3,2022,10,0,0,0,0,0,0,0,0,33,411,2,0,86.1,41.1],[1578,3,2021,14,0,0,0,0,0,0,0,0,33,330,2,1,76.0,36.2]],"WAS|4":[[1579,0,2024,17,331,480,3568,25,9,148,891,6,0,0,0,0,355.8,102.7],[1580,0,2023,17,388,612,3946,21,21,48,263,5,1,4,0,2,257.5,66.0],[1581,0,2021,16,321,494,3419,20,15,60,313,1,1,-2,0,2,222.9,59.6],[811,0,2025,10,139,227,1695,10,7,50,297,1,0,0,0,3,125.5,31.9],[1204,1,2021,16,0,0,0,0,0,258,1037,7,42,294,3,4,229.1,72.4],[1582,1,2023,15,0,0,0,0,0,178,733,5,36,368,4,2,198.1,63.1],[1583,1,2025,17,0,0,0,0,0,175,805,8,9,68,0,2,140.3,47.0],[1103,1,2024,12,0,0,0,0,0,77,367,4,35,366,0,0,132.3,44.0],[1205,1,2021,11,0,0,0,0,0,48,212,2,43,397,2,0,127.9,41.7],[1584,1,2025,12,0,0,0,0,0,112,500,6,3,30,0,0,92.0,30.3],[1208,2,2024,17,0,0,0,0,0,2,2,0,82,1096,13,1,267.8,91.2],[1338,2,2025,16,0,0,0,0,0,17,75,1,72,727,5,0,188.2,64.1],[1237,2,2022,17,0,0,0,0,0,38,187,1,64,656,4,1,176.3,60.0],[1531,2,2022,12,0,0,0,0,0,2,-7,0,35,523,7,0,130.6,44.5],[1252,2,2024,16,0,0,0,0,0,1,8,0,45,506,3,0,114.4,39.0],[1437,2,2021,17,0,0,0,0,0,10,89,0,24,296,3,0,86.5,29.5],[1414,2,2024,11,0,0,0,0,0,0,0,0,35,453,1,0,86.3,29.4],[1228,2,2021,17,0,0,0,0,0,0,0,0,41,383,0,0,79.3,27.0],[871,3,2024,17,0,0,0,0,0,0,0,0,66,654,7,0,177.4,84.6],[1212,3,2023,16,0,0,0,0,0,1,2,0,55,496,4,2,126.8,60.5],[1101,3,2021,11,0,0,0,0,0,0,0,0,30,271,2,0,69.1,33.0],[1585,3,2021,12,0,0,0,0,0,0,0,0,20,249,1,0,50.9,24.3]],"LV|4":[[1041,0,2021,17,428,626,4804,23,14,40,108,0,0,0,0,5,257.0,73.2],[856,0,2025,15,302,448,3025,19,17,41,109,0,0,0,0,1,173.9,46.8],[1586,0,2023,11,213,343,2218,12,7,17,11,1,0,0,0,2,125.8,30.9],[1214,0,2024,10,203,306,2013,9,10,19,58,0,0,0,0,4,96.3,23.8],[1272,1,2022,17,0,0,0,0,0,340,1653,12,53,400,0,1,328.3,110.0],[1587,1,2025,17,0,0,0,0,0,266,975,5,55,346,5,1,245.1,75.3],[919,1,2024,15,0,0,0,0,0,66,311,2,40,261,3,1,125.2,41.5],[1346,1,2024,14,0,0,0,0,0,132,420,4,36,294,1,1,137.4,39.7],[1095,1,2021,12,0,0,0,0,0,63,254,2,30,291,1,0,102.5,32.7],[1588,1,2023,13,0,0,0,0,0,104,451,1,15,98,0,1,73.9,24.0],[799,2,2022,17,0,0,0,0,0,3,-1,0,100,1516,14,0,335.5,114.2],[1275,2,2021,17,0,0,0,0,0,3,3,0,103,1038,9,1,259.1,88.2],[1243,2,2023,16,2,3,12,1,0,4,24,2,71,807,8,0,218.6,74.4],[1589,2,2025,17,0,0,0,0,0,11,51,0,57,696,5,0,161.7,55.1],[1445,2,2022,17,1,1,4,0,0,4,40,0,57,690,4,0,154.2,52.5],[1590,2,2021,16,0,0,0,0,0,1,0,0,34,571,3,0,109.1,37.1],[1292,2,2021,15,0,0,0,0,0,2,3,0,47,546,1,1,105.9,36.1],[1277,2,2021,7,0,0,0,0,0,3,16,0,24,469,2,0,84.5,28.8],[1591,3,2024,17,0,0,0,0,0,5,13,0,112,1194,5,0,262.7,125.3],[1278,3,2021,11,0,0,0,0,0,0,0,0,55,665,2,0,133.5,63.7],[1279,3,2022,14,0,0,0,0,0,0,2,0,33,420,2,0,87.2,41.6],[1592,3,2025,13,0,0,0,0,0,0,0,0,35,328,1,0,73.8,35.2]],"CLE|4":[[1175,0,2022,14,236,369,2608,12,6,49,243,2,0,0,0,4,168.6,45.2],[1262,0,2021,14,253,418,3010,17,13,37,134,1,0,11,0,3,180.9,45.1],[941,0,2024,11,181,296,2121,13,12,25,83,1,0,0,0,2,131.1,30.9],[709,0,2023,5,123,204,1616,13,8,9,2,0,0,0,0,1,100.8,26.1],[1265,1,2022,17,0,0,0,0,0,302,1525,12,27,239,1,1,281.4,96.0],[1593,1,2023,17,0,0,0,0,0,204,813,4,44,319,5,1,211.2,66.3],[1594,1,2025,14,0,0,0,0,0,230,827,7,26,171,0,0,169.8,50.4],[1158,1,2022,17,0,0,0,0,0,123,468,3,35,210,1,0,126.8,39.1],[1595,1,2021,13,0,0,0,0,0,100,534,3,19,137,0,0,104.1,37.0],[1596,1,2025,15,0,0,0,0,0,65,175,0,33,271,2,1,87.6,25.0],[1044,2,2022,17,0,1,0,0,1,0,0,0,78,1160,9,0,246.0,83.8],[1316,2,2024,17,0,0,0,0,0,0,0,0,90,1229,4,0,240.9,82.0],[1597,2,2022,17,0,0,0,0,0,1,2,0,61,839,3,1,167.1,56.9],[1076,2,2021,12,0,0,0,0,0,6,40,2,52,570,2,2,133.0,45.3],[1538,2,2023,16,0,0,0,0,0,9,11,0,59,640,2,2,132.1,45.0],[1598,2,2024,9,0,0,0,0,0,1,-5,0,29,339,3,1,80.4,27.4],[1267,2,2021,12,0,0,0,0,0,0,0,0,24,275,1,0,57.5,19.6],[1599,2,2025,15,0,0,0,0,0,5,29,0,18,338,0,0,54.7,18.6],[1270,3,2023,16,0,0,0,0,0,0,0,0,81,882,6,2,201.2,95.9],[1600,3,2025,16,0,0,0,0,0,7,13,1,72,731,6,1,186.4,88.9],[1253,3,2021,15,0,0,0,0,0,0,0,0,38,345,3,0,92.5,44.1],[1368,3,2024,16,0,0,0,0,0,0,0,0,40,390,2,0,91.0,43.4]],"NO|4":[[1041,0,2023,17,375,548,3878,25,8,32,40,0,0,0,0,3,241.1,70.1],[1024,0,2022,14,252,378,2871,18,9,30,54,0,0,0,0,1,174.2,50.1],[1601,0,2025,11,221,327,2384,10,6,45,186,3,0,0,0,2,158.0,44.7],[941,0,2021,7,95,161,1170,14,3,32,166,1,0,0,0,1,117.4,32.9],[1088,1,2024,14,0,0,0,0,0,228,950,6,68,543,2,0,265.3,85.1],[908,1,2021,7,0,0,0,0,0,68,260,1,20,138,0,1,63.8,19.6],[1602,1,2025,9,0,0,0,0,0,57,206,2,17,104,0,0,60.0,18.2],[1603,1,2025,5,0,0,0,0,0,46,198,1,12,103,0,0,48.1,15.6],[1167,1,2023,13,0,0,0,0,0,106,306,1,18,62,0,0,60.8,14.8],[1604,2,2025,16,0,1,0,0,1,1,-3,0,100,1163,9,0,268.0,91.2],[1605,2,2023,15,0,0,0,0,0,7,37,0,46,719,5,0,157.6,53.7],[1606,2,2021,17,0,0,0,0,0,0,0,0,46,698,6,0,151.8,51.7],[1091,2,2021,13,0,0,0,0,0,5,41,0,36,570,3,0,115.1,39.2],[1089,2,2023,10,0,0,0,0,0,0,0,0,39,448,1,0,89.8,30.6],[1090,2,2021,10,0,0,0,0,0,0,0,0,32,377,3,0,87.7,29.9],[1170,2,2024,8,0,0,0,0,0,1,4,0,17,385,4,0,79.9,27.2],[1574,2,2025,9,0,0,0,0,0,0,0,0,25,293,2,0,66.3,22.6],[1607,3,2025,17,0,0,0,0,0,0,0,0,77,889,3,2,179.9,85.8],[1092,3,2022,16,13,19,240,2,0,96,575,7,9,77,2,0,145.8,69.5],[1279,3,2024,16,0,0,0,0,0,0,0,0,32,413,5,0,103.3,49.3],[1608,3,2021,11,0,0,0,0,0,0,0,0,27,263,2,1,63.3,30.2]],"DAL|4":[[1122,0,2023,17,410,590,4516,36,9,55,242,2,0,0,0,2,342.8,101.3],[1609,0,2024,12,187,308,1844,12,5,26,18,0,0,0,0,3,109.6,25.8],[1124,1,2022,16,0,0,0,0,0,193,1007,9,39,371,3,0,248.8,86.3],[1570,1,2025,16,0,0,0,0,0,252,1201,11,35,137,2,2,242.8,81.6],[1123,1,2021,17,1,1,4,0,0,237,1002,10,47,287,2,1,252.1,81.2],[1610,1,2024,16,0,0,0,0,0,235,1079,2,39,249,3,2,197.8,65.9],[1126,2,2023,17,0,0,0,0,0,14,113,2,135,1749,12,2,403.2,130],[1389,2,2025,17,0,0,0,0,0,0,0,0,93,1429,9,0,291.9,99.4],[1044,2,2021,15,0,0,0,0,0,0,0,0,68,865,8,0,202.5,68.9],[910,2,2023,16,0,0,0,0,0,5,35,0,54,657,8,0,173.2,59.0],[1611,2,2024,17,0,0,0,0,0,0,0,0,49,610,7,0,152.0,51.8],[1568,2,2021,14,3,3,88,0,0,2,11,0,45,602,6,0,147.8,50.3],[1414,2,2022,16,0,0,0,0,0,0,0,0,43,555,3,1,114.5,39.0],[1612,2,2025,15,0,0,0,0,0,4,25,0,40,475,4,0,114.0,38.8],[1129,3,2021,17,0,0,0,0,0,0,0,0,78,808,8,0,208.8,99.6],[1613,3,2025,17,0,0,0,0,0,1,1,0,82,600,8,2,188.1,89.7],[1614,3,2024,12,0,0,0,0,0,0,0,0,27,241,1,0,57.1,27.2],[1615,3,2022,12,0,0,0,0,0,1,2,1,11,103,2,0,39.5,18.8]],"CIN|4":[[1298,0,2024,17,460,652,4918,43,9,42,201,2,0,0,0,5,372.8,110.9],[1616,0,2023,9,171,243,1936,12,7,27,127,3,1,-7,0,0,144.4,43.7],[709,0,2025,9,158,256,1664,13,4,15,22,1,0,0,0,1,120.8,31.9],[1300,1,2021,16,0,0,0,0,0,292,1205,13,42,314,3,1,287.9,92.2],[1617,1,2025,17,0,0,0,0,0,232,1019,6,69,437,5,0,282.6,92.1],[1207,1,2022,16,0,0,0,0,0,95,394,2,38,287,4,0,142.1,45.6],[1291,1,2024,8,0,0,0,0,0,74,242,2,23,187,1,1,81.9,24.1],[1618,1,2021,9,0,0,0,0,0,17,77,0,15,151,2,0,49.8,16.3],[1619,2,2024,17,0,0,0,0,0,3,32,0,127,1708,17,0,403.0,130],[1302,2,2024,12,0,0,0,0,0,0,0,0,73,911,10,1,222.1,75.6],[1301,2,2021,16,1,1,46,0,0,2,22,0,67,828,5,0,183.8,62.6],[1620,2,2024,17,0,0,0,0,0,0,0,0,36,479,6,0,119.9,40.8],[1621,2,2022,9,0,0,0,0,0,1,11,0,15,231,4,0,63.2,21.5],[1375,3,2024,16,0,0,0,0,0,0,0,0,65,665,2,1,141.5,67.5],[1307,3,2021,16,0,0,0,0,0,0,0,0,49,493,5,0,128.3,61.2],[1087,3,2022,13,0,0,0,0,0,0,0,0,52,414,2,0,105.4,50.3],[1622,3,2023,12,0,0,0,0,0,0,0,0,39,352,1,0,80.2,38.2]],"DET|4":[[1280,0,2024,17,390,539,4629,37,12,35,56,0,1,7,1,0,324.5,99.5],[1623,1,2024,17,0,0,0,0,0,250,1412,16,52,517,4,1,362.9,126.3],[1167,1,2022,17,0,0,0,0,0,262,1066,17,12,73,0,2,225.9,71.6],[1256,1,2024,14,1,1,3,1,0,185,775,12,36,341,0,1,221.7,71.1],[1114,1,2021,13,0,1,0,0,0,151,617,5,62,452,2,1,208.9,66.6],[1106,1,2022,15,0,0,0,0,0,42,170,1,12,101,1,0,51.1,16.2],[1624,2,2023,16,0,0,0,0,0,4,24,0,119,1515,10,1,330.9,112.7],[1625,2,2025,17,0,0,0,0,0,6,12,0,65,1117,7,0,219.9,74.9],[1626,2,2021,16,0,0,0,0,0,4,28,0,48,576,4,0,132.4,45.1],[1285,2,2023,16,0,0,0,0,0,0,0,0,40,608,5,1,128.8,43.9],[1218,2,2022,11,0,0,0,0,0,0,0,0,30,502,3,0,98.2,33.4],[1315,2,2024,15,0,0,0,0,0,0,0,0,33,394,3,0,92.4,31.5],[1627,2,2025,14,0,0,0,0,0,0,0,0,16,239,6,0,75.9,25.8],[1119,2,2021,5,0,0,0,0,0,0,0,0,15,204,2,0,49.4,16.8],[1628,3,2023,17,0,0,0,0,0,1,4,0,86,889,10,0,239.3,114.1],[1121,3,2021,12,0,0,0,0,0,0,0,0,61,583,4,0,145.3,69.3],[1629,3,2022,14,0,0,0,0,0,0,0,0,18,216,4,0,63.6,30.3],[1630,3,2022,8,0,0,0,0,0,0,0,0,11,60,4,0,41.0,19.6]],"CAR|4":[[1631,0,2025,16,304,478,3011,23,11,54,216,2,0,0,0,4,218.0,58.2],[1196,0,2021,12,243,406,2527,9,13,48,222,5,0,0,0,4,157.3,34.5],[873,0,2021,7,69,126,684,4,5,47,230,5,0,0,0,1,86.4,18.0],[1262,0,2022,7,119,206,1313,6,6,16,52,1,0,0,0,1,73.7,14.2],[1632,1,2024,15,0,0,0,0,0,250,1195,10,43,171,1,3,241.6,81.3],[1610,1,2025,17,0,0,0,0,0,236,1076,6,39,297,1,1,216.3,71.7],[1363,1,2022,16,0,0,0,0,0,203,914,5,5,26,0,0,131.0,43.6],[1233,1,2021,7,0,0,0,0,0,99,442,1,37,343,1,0,127.5,41.8],[919,1,2021,11,0,0,0,0,0,44,136,0,35,272,1,0,81.8,24.8],[1189,1,2023,16,0,0,0,0,0,129,432,1,27,154,0,2,87.6,24.3],[1236,2,2021,17,0,0,0,0,0,8,48,0,93,1157,4,1,237.5,80.9],[1347,2,2023,17,0,0,0,0,0,1,6,0,103,1014,4,0,231.0,78.7],[1633,2,2025,17,0,0,0,0,0,0,0,0,70,1014,7,0,213.4,72.7],[1198,2,2021,17,0,0,0,0,0,3,36,0,53,519,5,0,138.5,47.2],[1634,2,2024,15,0,0,0,0,0,6,24,0,49,497,4,0,125.1,42.6],[1218,2,2023,14,0,0,0,0,0,0,0,0,35,525,5,1,115.5,39.3],[1635,2,2024,11,1,1,19,0,0,0,0,0,32,478,2,0,92.6,31.5],[1327,2,2024,15,0,0,0,0,0,1,0,0,32,351,3,0,85.1,29.0],[1636,3,2024,15,0,0,0,0,0,0,0,0,33,342,1,0,73.2,34.9],[1637,3,2025,15,0,0,0,0,0,0,0,0,27,249,2,0,63.9,30.5],[1638,3,2025,14,0,0,0,0,0,1,1,0,19,171,2,0,48.2,23.0],[1087,3,2023,9,0,0,0,0,0,0,0,0,18,184,1,0,42.4,20.2]]}};
const OPP_DATA = [[1999,"ARI","6–10",60.8,null],[1999,"ATL","5–11",67.4,null],[1999,"BAL","8–8",90.0,null],[1999,"BUF","11–5",96.9,111.1],[1999,"CAR","8–8",88.8,null],[1999,"CHI","6–10",71.5,null],[1999,"CIN","4–12",54.4,null],[1999,"CLE","2–14",47.6,null],[1999,"DAL","8–8",94.6,110.2],[1999,"DEN","6–10",81.9,null],[1999,"DET","8–8",82.3,105.5],[1999,"GB","8–8",85.0,null],[1999,"IND","13–3",96.8,111.1],[1999,"JAX","14–2",110.9,116.6],[1999,"KC","9–7",93.3,null],[1999,"LA","13–3",120,122],[1999,"LAC","8–8",75.0,null],[1999,"LV","8–8",92.2,null],[1999,"MIA","9–7",80.9,104.9],[1999,"MIN","10–6",92.7,109.5],[1999,"NE","8–8",84.9,null],[1999,"NO","3–13",54.9,null],[1999,"NYG","7–9",73.1,null],[1999,"NYJ","8–8",82.3,null],[1999,"PHI","5–11",69.0,null],[1999,"PIT","6–10",82.0,null],[1999,"SEA","9–7",88.8,108.0],[1999,"SF","4–12",57.4,null],[1999,"TB","11–5",88.1,107.7],[1999,"TEN","13–3",93.3,109.7],[1999,"WAS","10–6",93.0,109.6],[2000,"ARI","3–13",45.5,null],[2000,"ATL","4–12",56.9,null],[2000,"BAL","12–4",109.2,115.9],[2000,"BUF","8–8",76.9,null],[2000,"CAR","7–9",82.5,null],[2000,"CHI","5–11",60.4,null],[2000,"CIN","4–12",54.9,null],[2000,"CLE","3–13",45,null],[2000,"DAL","5–11",71.9,null],[2000,"DEN","11–5",100.9,112.7],[2000,"DET","9–7",82.5,null],[2000,"GB","9–7",87.3,null],[2000,"IND","10–6",98.9,111.9],[2000,"JAX","7–9",88.8,null],[2000,"KC","7–9",82.7,null],[2000,"LA","10–6",93.5,109.8],[2000,"LAC","1–15",55.4,null],[2000,"LV","12–4",111.1,116.6],[2000,"MIA","11–5",97.9,111.5],[2000,"MIN","11–5",86.6,107.1],[2000,"NE","5–11",72.7,null],[2000,"NO","10–6",90.3,108.6],[2000,"NYG","12–4",95.5,110.6],[2000,"NYJ","9–7",82.5,null],[2000,"PHI","11–5",99.3,112.1],[2000,"PIT","9–7",93.0,null],[2000,"SEA","6–10",69.0,null],[2000,"SF","6–10",77.1,null],[2000,"TB","10–6",101.4,112.9],[2000,"TEN","13–3",107.1,115.1],[2000,"WAS","8–8",84.4,null],[2001,"ARI","7–9",74.9,null],[2001,"ATL","7–9",68.8,null],[2001,"BAL","10–6",88.5,107.9],[2001,"BUF","3–13",57.9,null],[2001,"CAR","1–15",57.6,null],[2001,"CHI","13–3",103.9,113.9],[2001,"CIN","6–10",69.3,null],[2001,"CLE","7–9",77.1,null],[2001,"DAL","5–11",67.9,null],[2001,"DEN","8–8",82.7,null],[2001,"DET","2–14",58.1,null],[2001,"GB","12–4",102.2,113.2],[2001,"IND","6–10",70.9,null],[2001,"JAX","6–10",83.8,null],[2001,"KC","6–10",78.7,null],[2001,"LA","14–2",119.0,119.7],[2001,"LAC","5–11",84.2,null],[2001,"LV","10–6",93.9,110.0],[2001,"MIA","11–5",91.1,108.9],[2001,"MIN","5–11",66.6,null],[2001,"NE","11–5",98.2,111.6],[2001,"NO","7–9",70.4,null],[2001,"NYG","7–9",78.2,null],[2001,"NYJ","10–6",84.6,106.3],[2001,"PHI","11–5",103.9,113.9],[2001,"PIT","13–3",104.7,114.2],[2001,"SEA","9–7",78.8,null],[2001,"SF","12–4",102.7,113.4],[2001,"TB","9–7",89.5,108.2],[2001,"TEN","7–9",74.2,null],[2001,"WAS","8–8",75.0,null],[2002,"ARI","5–11",57.9,null],[2002,"ATL","9–6–1",96.5,111.0],[2002,"BAL","7–9",76.5,null],[2002,"BUF","8–8",79.6,null],[2002,"CAR","7–9",75.5,null],[2002,"CHI","4–12",66.9,null],[2002,"CIN","2–14",54.4,null],[2002,"CLE","9–7",86.3,107.0],[2002,"DAL","5–11",64.7,null],[2002,"DEN","9–7",90.1,null],[2002,"DET","3–13",59.5,null],[2002,"GB","12–4",93.6,109.8],[2002,"HOU","4–12",59.8,null],[2002,"IND","10–6",88.2,107.8],[2002,"JAX","6–10",84.6,null],[2002,"KC","8–8",93.3,null],[2002,"LA","7–9",74.1,null],[2002,"LAC","8–8",77.1,null],[2002,"LV","11–5",105.7,114.5],[2002,"MIA","9–7",94.7,null],[2002,"MIN","6–10",74.2,null],[2002,"NE","9–7",88.1,null],[2002,"NO","9–7",89.5,null],[2002,"NYG","10–6",89.0,108.1],[2002,"NYJ","9–7",86.2,106.9],[2002,"PHI","12–4",110.1,116.3],[2002,"PIT","10–5–1",89.6,108.3],[2002,"SEA","7–9",80.3,null],[2002,"SF","10–6",85.0,106.5],[2002,"TB","12–4",106.3,114.8],[2002,"TEN","11–5",89.3,108.2],[2002,"WAS","7–9",73.3,null],[2003,"ARI","4–12",46.5,null],[2003,"ATL","5–11",63.0,null],[2003,"BAL","10–6",100.0,112.3],[2003,"BUF","6–10",76.8,null],[2003,"CAR","11–5",85.8,106.8],[2003,"CHI","7–9",72.5,null],[2003,"CIN","8–8",76.5,null],[2003,"CLE","5–11",71.7,null],[2003,"DAL","10–6",87.1,107.3],[2003,"DEN","10–6",95.2,110.5],[2003,"DET","5–11",65.2,null],[2003,"GB","10–6",103.9,113.9],[2003,"HOU","5–11",62.7,null],[2003,"IND","12–4",100.1,112.4],[2003,"JAX","5–11",73.8,null],[2003,"KC","13–3",106.6,114.9],[2003,"LA","12–4",101.4,112.9],[2003,"LAC","4–12",62.2,null],[2003,"LV","4–12",65.2,null],[2003,"MIA","10–6",90.4,null],[2003,"MIN","9–7",92.5,null],[2003,"NE","14–2",100.0,112.3],[2003,"NO","8–8",84.7,null],[2003,"NYG","4–12",59.6,null],[2003,"NYJ","6–10",80.0,null],[2003,"PHI","12–4",96.3,110.9],[2003,"PIT","6–10",78.2,null],[2003,"SEA","10–6",94.7,110.3],[2003,"SF","7–9",90.0,null],[2003,"TB","7–9",88.4,null],[2003,"TEN","12–4",100.1,112.4],[2003,"WAS","5–11",69.0,null],[2004,"ARI","6–10",76.5,null],[2004,"ATL","11–5",83.0,105.7],[2004,"BAL","9–7",90.3,null],[2004,"BUF","9–7",100.1,null],[2004,"CAR","7–9",85.0,null],[2004,"CHI","5–11",66.6,null],[2004,"CIN","8–8",82.8,null],[2004,"CLE","4–12",64.4,null],[2004,"DAL","6–10",64.7,null],[2004,"DEN","10–6",94.7,110.3],[2004,"DET","6–10",73.9,null],[2004,"GB","10–6",89.5,108.2],[2004,"HOU","7–9",77.7,null],[2004,"IND","12–4",109.6,116.1],[2004,"JAX","9–7",79.5,null],[2004,"KC","7–9",90.1,null],[2004,"LA","8–8",70.9,101.0],[2004,"LAC","12–4",103.6,113.7],[2004,"LV","5–11",63.1,null],[2004,"MIA","4–12",70.0,null],[2004,"MIN","8–8",84.1,106.1],[2004,"NE","14–2",110.6,116.5],[2004,"NO","8–8",73.5,null],[2004,"NYG","6–10",75.5,null],[2004,"NYJ","10–6",93.9,110.0],[2004,"PHI","13–3",102.5,113.3],[2004,"PIT","15–1",101.7,113.0],[2004,"SEA","9–7",82.2,105.4],[2004,"SF","2–14",51.9,null],[2004,"TB","5–11",82.0,null],[2004,"TEN","5–11",67.4,null],[2004,"WAS","6–10",78.5,null],[2005,"ARI","5–11",70.4,null],[2005,"ATL","8–8",84.1,null],[2005,"BAL","6–10",77.1,null],[2005,"BUF","5–11",67.3,null],[2005,"CAR","11–5",103.5,113.7],[2005,"CHI","11–5",91.7,109.1],[2005,"CIN","11–5",93.8,109.9],[2005,"CLE","6–10",71.5,null],[2005,"DAL","9–7",85.2,null],[2005,"DEN","13–3",104.2,114.0],[2005,"DET","5–11",68.1,null],[2005,"GB","4–12",75.2,null],[2005,"HOU","2–14",55.4,null],[2005,"IND","14–2",113.0,117.4],[2005,"JAX","12–4",97.1,111.2],[2005,"KC","10–6",94.9,null],[2005,"LA","6–10",72.0,null],[2005,"LAC","9–7",99.3,null],[2005,"LV","4–12",67.7,null],[2005,"MIA","9–7",82.7,null],[2005,"MIN","9–7",76.5,null],[2005,"NE","10–6",89.0,108.1],[2005,"NO","3–13",56.6,null],[2005,"NYG","11–5",99.6,112.2],[2005,"NYJ","4–12",64.2,null],[2005,"PHI","6–10",70.1,null],[2005,"PIT","11–5",103.3,113.6],[2005,"SEA","13–3",111.2,116.7],[2005,"SF","4–12",52.5,null],[2005,"TB","11–5",86.6,107.1],[2005,"TEN","4–12",63.1,null],[2005,"WAS","10–6",93.0,109.6],[2006,"ARI","5–11",70.6,null],[2006,"ATL","7–9",76.8,null],[2006,"BAL","13–3",106.6,114.9],[2006,"BUF","7–9",80.8,null],[2006,"CAR","8–8",76.9,null],[2006,"CHI","13–3",109.8,116.1],[2006,"CIN","8–8",89.2,null],[2006,"CLE","4–12",63.8,null],[2006,"DAL","9–7",94.4,110.2],[2006,"DEN","9–7",84.7,null],[2006,"DET","3–13",67.7,null],[2006,"GB","8–8",72.2,null],[2006,"HOU","6–10",66.8,null],[2006,"IND","12–4",93.1,109.7],[2006,"JAX","8–8",97.9,null],[2006,"KC","9–7",85.0,106.5],[2006,"LA","8–8",80.3,null],[2006,"LAC","14–2",112.5,117.2],[2006,"LV","2–14",56.5,null],[2006,"MIA","6–10",78.8,null],[2006,"MIN","6–10",75.4,null],[2006,"NE","12–4",106.0,114.7],[2006,"NO","10–6",96.9,111.1],[2006,"NYG","8–8",81.4,105.1],[2006,"NYJ","10–6",85.8,106.8],[2006,"PHI","10–6",93.6,109.8],[2006,"PIT","8–8",88.5,null],[2006,"SEA","9–7",81.5,105.2],[2006,"SF","7–9",64.4,null],[2006,"TB","4–12",60.0,null],[2006,"TEN","8–8",70.4,null],[2006,"WAS","5–11",71.5,null],[2007,"ARI","8–8",83.3,null],[2007,"ATL","4–12",57.9,null],[2007,"BAL","5–11",65.2,null],[2007,"BUF","7–9",66.3,null],[2007,"CAR","7–9",69.8,null],[2007,"CHI","7–9",80.3,null],[2007,"CIN","7–9",81.7,null],[2007,"CLE","10–6",85.7,null],[2007,"DAL","13–3",103.1,113.6],[2007,"DEN","7–9",68.4,null],[2007,"DET","7–9",66.9,null],[2007,"GB","13–3",105.4,114.4],[2007,"HOU","8–8",81.7,null],[2007,"IND","13–3",112.3,117.1],[2007,"JAX","11–5",99.5,112.1],[2007,"KC","4–12",65.2,null],[2007,"LA","3–13",54.7,null],[2007,"LAC","11–5",102.8,113.4],[2007,"LV","4–12",64.2,null],[2007,"MIA","1–15",55.5,null],[2007,"MIN","8–8",91.1,null],[2007,"NE","16–0",120,122],[2007,"NO","7–9",81.1,null],[2007,"NYG","10–6",86.0,106.9],[2007,"NYJ","4–12",68.7,null],[2007,"PHI","8–8",88.2,null],[2007,"PIT","10–6",102.2,113.2],[2007,"SEA","10–6",98.7,111.8],[2007,"SF","5–11",59.5,null],[2007,"TB","9–7",92.7,109.5],[2007,"TEN","10–6",83.1,105.8],[2007,"WAS","9–7",86.3,107.0],[2008,"ARI","9–7",82.7,105.6],[2008,"ATL","11–5",93.0,109.6],[2008,"BAL","11–5",104.9,114.2],[2008,"BUF","7–9",81.5,null],[2008,"CAR","12–4",96.0,110.8],[2008,"CHI","9–7",86.5,null],[2008,"CIN","4–11–1",57.1,null],[2008,"CLE","4–12",63.8,null],[2008,"DAL","9–7",82.0,null],[2008,"DEN","8–8",70.1,null],[2008,"DET","0–16",45,null],[2008,"GB","6–10",88.7,null],[2008,"HOU","8–8",78.1,null],[2008,"IND","12–4",95.0,110.4],[2008,"JAX","5–11",72.2,null],[2008,"KC","2–14",58.8,null],[2008,"LA","2–14",45.5,null],[2008,"LAC","8–8",97.1,111.2],[2008,"LV","5–11",62.7,null],[2008,"MIA","11–5",86.9,107.3],[2008,"MIN","10–6",89.8,108.4],[2008,"NE","11–5",98.5,null],[2008,"NO","8–8",93.6,null],[2008,"NYG","12–4",103.6,113.7],[2008,"NYJ","9–7",90.3,null],[2008,"PHI","9–6–1",102.7,113.4],[2008,"PIT","12–4",102.2,113.2],[2008,"SEA","4–12",66.9,null],[2008,"SF","7–9",75.8,null],[2008,"TB","9–7",88.5,null],[2008,"TEN","13–3",104.9,114.2],[2008,"WAS","8–8",77.6,null],[2009,"ARI","10–6",90.4,108.6],[2009,"ATL","9–7",88.5,null],[2009,"BAL","9–7",103.1,113.6],[2009,"BUF","6–10",71.7,null],[2009,"CAR","8–8",83.6,null],[2009,"CHI","7–9",74.9,null],[2009,"CIN","10–6",84.7,106.4],[2009,"CLE","5–11",61.9,null],[2009,"DAL","11–5",100.1,112.4],[2009,"DEN","8–8",82.8,null],[2009,"DET","2–14",45.7,null],[2009,"GB","11–5",108.5,115.7],[2009,"HOU","9–7",91.2,null],[2009,"IND","14–2",99.8,112.3],[2009,"JAX","7–9",68.2,null],[2009,"KC","4–12",61.9,null],[2009,"LA","1–15",45,null],[2009,"LAC","13–3",103.8,113.8],[2009,"LV","5–11",53.6,null],[2009,"MIA","7–9",77.7,null],[2009,"MIN","12–4",107.6,115.3],[2009,"NE","10–6",105.0,114.3],[2009,"NO","13–3",109.3,116.0],[2009,"NYG","8–8",78.5,null],[2009,"NYJ","9–7",100.3,112.4],[2009,"PHI","11–5",97.1,111.2],[2009,"PIT","9–7",89.5,null],[2009,"SEA","5–11",65.0,null],[2009,"SF","8–8",90.3,null],[2009,"TB","3–13",57.7,null],[2009,"TEN","8–8",74.9,null],[2009,"WAS","4–12",71.4,null],[2010,"ARI","5–11",59.5,null],[2010,"ATL","13–3",102.5,113.3],[2010,"BAL","12–4",96.3,110.9],[2010,"BUF","4–12",60.0,null],[2010,"CAR","2–14",48.8,null],[2010,"CHI","11–5",90.1,108.5],[2010,"CIN","4–12",70.9,null],[2010,"CLE","5–11",72.8,null],[2010,"DAL","6–10",75.8,null],[2010,"DEN","4–12",62.3,null],[2010,"DET","6–10",81.4,null],[2010,"GB","10–6",106.0,114.7],[2010,"HOU","6–10",76.6,null],[2010,"IND","10–6",90.0,108.4],[2010,"JAX","8–8",72.0,null],[2010,"KC","10–6",88.8,108.0],[2010,"LA","7–9",76.3,null],[2010,"LAC","9–7",101.4,null],[2010,"LV","8–8",88.7,null],[2010,"MIA","7–9",73.0,null],[2010,"MIN","6–10",71.9,null],[2010,"NE","14–2",115.0,118.2],[2010,"NO","11–5",94.7,110.3],[2010,"NYG","10–6",90.0,null],[2010,"NYJ","11–5",92.5,109.4],[2010,"PHI","10–6",92.3,109.4],[2010,"PIT","12–4",105.2,114.4],[2010,"SEA","7–9",67.1,100],[2010,"SF","6–10",76.0,null],[2010,"TB","10–6",86.2,null],[2010,"TEN","6–10",85.2,null],[2010,"WAS","6–10",70.6,null],[2011,"ARI","8–8",76.8,null],[2011,"ATL","10–6",90.8,108.7],[2011,"BAL","12–4",100.3,112.4],[2011,"BUF","6–10",72.7,null],[2011,"CAR","6–10",78.8,null],[2011,"CHI","8–8",84.4,null],[2011,"CIN","9–7",85.8,106.8],[2011,"CLE","4–12",68.4,null],[2011,"DAL","8–8",86.0,null],[2011,"DEN","8–8",69.6,100.5],[2011,"DET","10–6",96.3,110.9],[2011,"GB","15–1",114.4,117.9],[2011,"HOU","10–6",98.9,111.9],[2011,"IND","2–14",52.8,null],[2011,"JAX","5–11",68.8,null],[2011,"KC","7–9",62.5,null],[2011,"LA","2–14",48.5,null],[2011,"LAC","8–8",87.1,null],[2011,"LV","8–8",70.8,null],[2011,"MIA","6–10",85.0,null],[2011,"MIN","3–13",65.2,null],[2011,"NE","13–3",109.6,116.1],[2011,"NO","13–3",115.5,118.4],[2011,"NYG","9–7",81.5,105.2],[2011,"NYJ","8–8",84.7,null],[2011,"PHI","8–8",93.3,null],[2011,"PIT","12–4",98.1,111.6],[2011,"SEA","7–9",83.5,null],[2011,"SF","13–3",106.5,114.8],[2011,"TB","4–12",49.6,null],[2011,"TEN","9–7",83.8,null],[2011,"WAS","5–11",70.0,null],[2012,"ARI","5–11",65.5,null],[2012,"ATL","13–3",101.5,112.9],[2012,"BAL","10–6",91.1,108.9],[2012,"BUF","6–10",68.1,null],[2012,"CAR","7–9",81.5,null],[2012,"CHI","10–6",98.1,null],[2012,"CIN","10–6",93.8,109.9],[2012,"CLE","5–11",72.0,null],[2012,"DAL","8–8",78.7,null],[2012,"DEN","13–3",113.0,117.4],[2012,"DET","4–12",72.2,null],[2012,"GB","11–5",97.9,111.5],[2012,"HOU","12–4",96.0,110.8],[2012,"IND","11–5",77.7,103.7],[2012,"JAX","2–14",52.5,null],[2012,"KC","2–14",48.5,null],[2012,"LA","7–8–1",74.7,null],[2012,"LAC","7–9",82.5,null],[2012,"LV","4–12",58.2,null],[2012,"MIA","7–9",77.9,null],[2012,"MIN","10–6",87.4,107.4],[2012,"NE","12–4",118.4,119.5],[2012,"NO","7–9",83.6,null],[2012,"NYG","9–7",96.0,null],[2012,"NYJ","6–10",67.6,null],[2012,"PHI","4–12",56.5,null],[2012,"PIT","8–8",86.0,null],[2012,"SEA","11–5",109.0,115.8],[2012,"SF","11–4–1",102.2,113.2],[2012,"TB","7–9",81.7,null],[2012,"TEN","6–10",60.1,null],[2012,"WAS","10–6",90.1,108.5],[2013,"ARI","10–6",91.2,null],[2013,"ATL","4–12",68.2,null],[2013,"BAL","8–8",77.4,null],[2013,"BUF","6–10",74.7,null],[2013,"CAR","12–4",102.3,113.2],[2013,"CHI","8–8",77.3,null],[2013,"CIN","11–5",102.3,113.2],[2013,"CLE","4–12",66.9,null],[2013,"DAL","8–8",83.6,null],[2013,"DEN","13–3",115.4,118.3],[2013,"DET","7–9",85.5,null],[2013,"GB","8–7–1",80.8,104.8],[2013,"HOU","2–14",58.4,null],[2013,"IND","11–5",91.2,108.9],[2013,"JAX","4–12",50.4,null],[2013,"KC","11–5",102.3,113.2],[2013,"LA","7–9",80.0,null],[2013,"LAC","9–7",90.1,108.5],[2013,"LV","4–12",61.7,null],[2013,"MIA","8–8",79.6,null],[2013,"MIN","5–10–1",68.4,null],[2013,"NE","12–4",99.3,112.1],[2013,"NO","11–5",100.0,112.3],[2013,"NYG","7–9",68.4,null],[2013,"NYJ","8–8",67.1,null],[2013,"PHI","10–6",92.0,109.2],[2013,"PIT","8–8",83.9,null],[2013,"SEA","13–3",112.0,117.0],[2013,"SF","12–4",103.8,113.8],[2013,"TB","4–12",66.5,null],[2013,"TEN","7–9",79.5,null],[2013,"WAS","3–13",59.6,null],[2014,"ARI","11–5",84.2,106.2],[2014,"ATL","6–10",76.8,null],[2014,"BAL","10–6",99.5,112.1],[2014,"BUF","9–7",91.1,null],[2014,"CAR","7–8–1",76.9,103.4],[2014,"CHI","5–11",63.0,null],[2014,"CIN","10–5–1",85.8,106.8],[2014,"CLE","7–9",76.5,null],[2014,"DAL","12–4",100.8,112.6],[2014,"DEN","12–4",102.8,113.4],[2014,"DET","11–5",88.7,107.9],[2014,"GB","12–4",104.4,114.0],[2014,"HOU","9–7",92.8,null],[2014,"IND","11–5",96.6,111.0],[2014,"JAX","3–13",56.6,null],[2014,"KC","9–7",93.9,null],[2014,"LA","6–10",77.7,null],[2014,"LAC","9–7",82.5,null],[2014,"LV","3–13",50.9,null],[2014,"MIA","8–8",84.9,null],[2014,"MIN","7–9",79.6,null],[2014,"NE","12–4",107.1,115.1],[2014,"NO","7–9",78.8,null],[2014,"NYG","6–10",79.3,null],[2014,"NYJ","4–12",63.8,null],[2014,"PHI","10–6",94.2,null],[2014,"PIT","11–5",93.3,109.7],[2014,"SEA","12–4",104.7,114.2],[2014,"SF","8–8",77.1,null],[2014,"TB","2–14",61.4,null],[2014,"TEN","2–14",53.3,null],[2014,"WAS","4–12",60.8,null],[2015,"ARI","13–3",110.4,116.4],[2015,"ATL","8–8",81.5,null],[2015,"BAL","5–11",70.9,null],[2015,"BUF","8–8",85.7,null],[2015,"CAR","15–1",113.0,117.4],[2015,"CHI","6–10",72.7,null],[2015,"CIN","12–4",104.7,114.2],[2015,"CLE","3–13",58.1,null],[2015,"DAL","4–12",66.8,null],[2015,"DEN","12–4",91.9,109.2],[2015,"DET","7–9",75.8,null],[2015,"GB","10–6",89.6,108.3],[2015,"HOU","9–7",86.6,107.1],[2015,"IND","8–8",70.6,null],[2015,"JAX","5–11",71.1,null],[2015,"KC","11–5",101.2,112.8],[2015,"LA","7–9",74.6,null],[2015,"LAC","4–12",70.1,null],[2015,"LV","7–9",76.2,null],[2015,"MIA","6–10",70.0,null],[2015,"MIN","11–5",92.5,109.4],[2015,"NE","12–4",106.3,114.8],[2015,"NO","7–9",71.7,null],[2015,"NYG","6–10",79.0,null],[2015,"NYJ","10–6",94.1,null],[2015,"PHI","7–9",74.1,null],[2015,"PIT","10–6",99.0,111.9],[2015,"SEA","10–6",105.7,114.5],[2015,"SF","5–11",58.8,null],[2015,"TB","6–10",70.6,null],[2015,"TEN","3–13",62.8,null],[2015,"WAS","9–7",83.9,106.1],[2016,"ARI","7–8–1",91.4,null],[2016,"ATL","11–5",103.8,113.8],[2016,"BAL","8–8",86.0,null],[2016,"BUF","7–9",85.8,null],[2016,"CAR","6–10",77.3,null],[2016,"CHI","3–13",63.5,null],[2016,"CIN","6–9–1",84.1,null],[2016,"CLE","1–15",52.7,null],[2016,"DAL","13–3",100.8,112.6],[2016,"DEN","9–7",88.2,null],[2016,"DET","9–7",80.6,104.8],[2016,"GB","10–6",89.5,108.2],[2016,"HOU","9–7",74.7,102.5],[2016,"IND","8–8",85.5,null],[2016,"JAX","3–13",69.5,null],[2016,"KC","12–4",94.9,110.3],[2016,"LA","4–12",55.5,null],[2016,"LAC","5–11",80.4,null],[2016,"LV","12–4",87.4,107.4],[2016,"MIA","10–6",79.8,104.5],[2016,"MIN","8–8",85.7,null],[2016,"NE","14–2",112.8,117.3],[2016,"NO","7–9",84.9,null],[2016,"NYG","11–5",86.6,107.1],[2016,"NYJ","5–11",61.2,null],[2016,"PHI","7–9",88.2,null],[2016,"PIT","11–5",93.9,110.0],[2016,"SEA","10–5–1",92.3,109.4],[2016,"SF","2–14",55.4,null],[2016,"TB","9–7",80.1,null],[2016,"TEN","9–7",83.0,null],[2016,"WAS","8–7–1",84.6,null],[2017,"ARI","8–8",72.0,null],[2017,"ATL","10–6",88.5,107.9],[2017,"BAL","9–7",97.1,null],[2017,"BUF","9–7",73.5,102.0],[2017,"CAR","11–5",88.2,107.8],[2017,"CHI","5–11",73.6,null],[2017,"CIN","7–9",73.1,null],[2017,"CLE","0–16",54.6,null],[2017,"DAL","9–7",86.0,null],[2017,"DEN","5–11",67.7,null],[2017,"DET","9–7",87.9,null],[2017,"GB","7–9",72.3,null],[2017,"HOU","4–12",66.9,null],[2017,"IND","4–12",60.1,null],[2017,"JAX","10–6",106.2,114.7],[2017,"KC","10–6",94.6,110.2],[2017,"LA","11–5",106.2,114.7],[2017,"LAC","9–7",95.7,null],[2017,"LV","6–10",71.1,null],[2017,"MIA","6–10",64.7,null],[2017,"MIN","13–3",103.1,113.6],[2017,"NE","13–3",108.2,115.5],[2017,"NO","11–5",101.9,113.1],[2017,"NYG","3–13",60.0,null],[2017,"NYJ","5–11",69.2,null],[2017,"PHI","13–3",108.2,115.5],[2017,"PIT","13–3",98.1,111.6],[2017,"SEA","9–7",87.9,null],[2017,"SF","6–10",74.2,null],[2017,"TB","5–11",75.0,null],[2017,"TEN","9–7",79.0,104.2],[2017,"WAS","7–9",75.2,null],[2018,"ARI","3–13",50.8,null],[2018,"ATL","7–9",81.1,null],[2018,"BAL","10–6",98.7,111.8],[2018,"BUF","6–10",65.8,null],[2018,"CAR","7–9",81.5,null],[2018,"CHI","12–4",104.4,114.0],[2018,"CIN","6–10",68.7,null],[2018,"CLE","7–8–1",77.3,null],[2018,"DAL","10–6",84.9,106.5],[2018,"DEN","6–10",79.3,null],[2018,"DET","6–10",76.8,null],[2018,"GB","6–9–1",78.7,null],[2018,"HOU","11–5",96.2,110.8],[2018,"IND","10–6",96.6,111.0],[2018,"JAX","5–11",71.2,null],[2018,"KC","12–4",105.4,114.4],[2018,"LA","13–3",105.2,114.4],[2018,"LAC","12–4",98.2,111.6],[2018,"LV","4–12",54.4,null],[2018,"MIA","7–9",64.4,null],[2018,"MIN","8–7–1",85.5,null],[2018,"NE","11–5",100.1,112.4],[2018,"NO","13–3",106.5,114.8],[2018,"NYG","5–11",75.7,null],[2018,"NYJ","4–12",65.4,null],[2018,"PHI","9–7",85.5,106.7],[2018,"PIT","9–6–1",93.3,null],[2018,"SEA","10–6",95.4,110.5],[2018,"SF","4–12",67.7,null],[2018,"TB","5–11",71.7,null],[2018,"TEN","9–7",83.6,null],[2018,"WAS","7–9",70.1,null],[2019,"ARI","5–10–1",69.6,null],[2019,"ATL","7–9",79.6,null],[2019,"BAL","14–2",120,120.9],[2019,"BUF","10–6",91.2,108.9],[2019,"CAR","5–11",61.9,null],[2019,"CHI","8–8",79.6,null],[2019,"CIN","2–14",60.1,null],[2019,"CLE","6–10",73.3,null],[2019,"DAL","8–8",100.4,null],[2019,"DEN","7–9",77.1,null],[2019,"DET","3–12–1",69.5,null],[2019,"GB","13–3",92.5,109.4],[2019,"HOU","10–6",81.4,105.1],[2019,"IND","7–9",80.6,null],[2019,"JAX","6–10",67.1,null],[2019,"KC","12–4",105.2,114.4],[2019,"LA","9–7",87.3,null],[2019,"LAC","5–11",81.2,null],[2019,"LV","7–9",65.7,null],[2019,"MIA","5–11",52.7,null],[2019,"MIN","10–6",99.0,111.9],[2019,"NE","12–4",113.5,117.6],[2019,"NO","13–3",101.1,112.8],[2019,"NYG","4–12",65.0,null],[2019,"NYJ","7–9",69.3,null],[2019,"PHI","9–7",87.4,107.4],[2019,"PIT","8–8",80.3,null],[2019,"SEA","11–5",83.6,106.0],[2019,"SF","13–3",109.3,116.0],[2019,"TB","7–9",83.9,null],[2019,"TEN","9–7",93.8,109.9],[2019,"WAS","3–13",55.7,null],[2020,"ARI","8–8",89.3,null],[2020,"ATL","4–12",79.6,null],[2020,"BAL","11–5",108.7,115.7],[2020,"BUF","13–3",102.5,113.3],[2020,"CAR","5–11",74.2,null],[2020,"CHI","8–8",82.8,105.7],[2020,"CIN","4–11–1",64.6,null],[2020,"CLE","11–5",80.8,104.8],[2020,"DAL","6–10",70.1,null],[2020,"DEN","5–11",63.0,null],[2020,"DET","5–11",60.0,null],[2020,"GB","13–3",104.7,114.2],[2020,"HOU","4–12",69.8,null],[2020,"IND","11–5",96.6,111.0],[2020,"JAX","1–15",53.0,null],[2020,"KC","14–2",100.1,112.4],[2020,"LA","10–6",94.6,110.2],[2020,"LAC","7–9",75.8,null],[2020,"LV","8–8",75.5,null],[2020,"MIA","10–6",93.0,null],[2020,"MIN","7–9",75.4,null],[2020,"NE","7–9",78.2,null],[2020,"NO","12–4",105.5,114.5],[2020,"NYG","6–10",70.3,null],[2020,"NYJ","2–14",48.5,null],[2020,"PHI","4–11–1",69.2,null],[2020,"PIT","12–4",99.0,111.9],[2020,"SEA","12–4",96.5,111.0],[2020,"SF","6–10",80.3,null],[2020,"TB","11–5",104.2,114.0],[2020,"TEN","11–5",90.8,108.7],[2020,"WAS","7–9",83.5,105.9],[2021,"ARI","11–6",94.9,110.4],[2021,"ATL","7–10",60.7,null],[2021,"BAL","8–9",81.8,null],[2021,"BUF","11–6",111.5,116.8],[2021,"CAR","5–12",67.6,null],[2021,"CHI","6–11",68.2,null],[2021,"CIN","10–7",95.1,110.4],[2021,"CLE","8–9",79.2,null],[2021,"DAL","12–5",108.2,115.5],[2021,"DEN","7–10",84.4,null],[2021,"DET","3–13–1",61.3,null],[2021,"GB","13–4",94.3,110.1],[2021,"HOU","4–13",56.8,null],[2021,"IND","9–8",95.3,null],[2021,"JAX","3–14",52.0,null],[2021,"KC","12–5",99.8,112.3],[2021,"LA","12–5",95.6,110.6],[2021,"LAC","9–8",84.7,null],[2021,"LV","10–7",72.8,101.8],[2021,"MIA","9–8",77.7,null],[2021,"MIN","8–9",82.4,null],[2021,"NE","10–7",106.3,114.8],[2021,"NO","9–8",86.8,null],[2021,"NYG","4–13",58.9,null],[2021,"NYJ","4–13",53.5,null],[2021,"PHI","9–8",91.3,109.0],[2021,"PIT","9–7–1",74.3,102.3],[2021,"SEA","7–10",86.8,null],[2021,"SF","10–7",91.8,109.1],[2021,"TB","13–4",106.1,114.7],[2021,"TEN","12–5",92.2,109.3],[2021,"WAS","7–10",67.7,null],[2022,"ARI","4–13",66.2,null],[2022,"ATL","7–10",79.4,null],[2022,"BAL","10–7",87.7,107.6],[2022,"BUF","13–3",109.3,116.0],[2022,"CAR","7–10",78.5,null],[2022,"CHI","3–14",62.0,null],[2022,"CIN","12–4",97.7,111.5],[2022,"CLE","7–10",79.5,null],[2022,"DAL","12–5",101.2,112.8],[2022,"DEN","5–12",71.7,null],[2022,"DET","9–8",86.4,null],[2022,"GB","8–9",82.4,null],[2022,"HOU","3–13–1",62.9,null],[2022,"IND","4–12–1",61.9,null],[2022,"JAX","9–8",90.6,108.7],[2022,"KC","14–3",101.5,112.9],[2022,"LA","5–12",71.0,null],[2022,"LAC","10–7",83.5,105.9],[2022,"LV","6–11",79.1,null],[2022,"MIA","9–8",82.2,105.4],[2022,"MIN","13–4",82.1,105.4],[2022,"NE","8–9",85.0,null],[2022,"NO","7–10",80.3,null],[2022,"NYG","9–7–1",81.6,105.2],[2022,"NYJ","7–10",79.5,null],[2022,"PHI","14–3",102.4,113.3],[2022,"PIT","9–8",76.8,null],[2022,"SEA","9–8",83.4,105.9],[2022,"SF","13–4",108.3,115.6],[2022,"TB","8–9",75.8,102.9],[2022,"TEN","7–10",73.4,null],[2022,"WAS","8–8–1",79.2,null],[2023,"ARI","4–13",63.8,null],[2023,"ATL","7–10",74.7,null],[2023,"BAL","13–4",112.8,117.3],[2023,"BUF","11–6",103.4,113.7],[2023,"CAR","2–15",55.6,null],[2023,"CHI","7–10",79.7,null],[2023,"CIN","9–8",79.8,null],[2023,"CLE","11–6",87.6,107.5],[2023,"DAL","12–5",111.5,116.8],[2023,"DEN","8–9",74.1,null],[2023,"DET","12–5",92.4,109.4],[2023,"GB","9–8",87.4,107.4],[2023,"HOU","10–7",86.1,106.9],[2023,"IND","9–8",79.7,null],[2023,"JAX","9–8",83.4,null],[2023,"KC","11–6",94.0,110.0],[2023,"LA","10–7",86.5,107.1],[2023,"LAC","5–12",74.7,null],[2023,"LV","8–9",82.6,null],[2023,"MIA","11–6",98.2,111.6],[2023,"MIN","7–10",79.8,null],[2023,"NE","4–13",63.1,null],[2023,"NO","9–8",93.7,null],[2023,"NYG","6–11",61.4,null],[2023,"NYJ","7–10",69.5,null],[2023,"PHI","11–6",83.2,105.8],[2023,"PIT","10–7",79.5,104.4],[2023,"SEA","9–8",76.8,null],[2023,"SF","12–5",111.3,116.7],[2023,"TB","9–8",85.9,106.9],[2023,"TEN","6–11",73.2,null],[2023,"WAS","4–13",54.3,null],[2024,"ARI","8–9",85.6,null],[2024,"ATL","8–9",77.4,null],[2024,"BAL","12–5",106.0,114.6],[2024,"BUF","13–4",106.0,114.6],[2024,"CAR","5–12",53.7,null],[2024,"CHI","5–12",73.5,null],[2024,"CIN","9–8",88.2,null],[2024,"CLE","3–14",56.1,null],[2024,"DAL","7–10",64.9,null],[2024,"DEN","10–7",99.5,112.2],[2024,"DET","15–2",115.7,118.4],[2024,"GB","11–6",100.7,112.6],[2024,"HOU","10–7",82.5,105.5],[2024,"IND","8–9",75.0,null],[2024,"JAX","4–13",65.3,null],[2024,"KC","15–2",91.3,109.0],[2024,"LA","10–7",79.7,104.4],[2024,"LAC","11–6",97.6,111.4],[2024,"LV","4–13",63.8,null],[2024,"MIA","8–9",79.7,null],[2024,"MIN","14–3",97.4,111.3],[2024,"NE","4–13",63.4,null],[2024,"NO","5–12",73.5,null],[2024,"NYG","3–14",61.3,null],[2024,"NYJ","5–12",72.6,null],[2024,"PHI","14–3",106.4,114.8],[2024,"PIT","10–7",87.4,107.4],[2024,"SEA","10–7",83.5,null],[2024,"SF","6–11",75.5,null],[2024,"TB","10–7",100.0,112.3],[2024,"TEN","3–14",60.2,null],[2024,"WAS","12–5",96.5,111.0],[2025,"ARI","3–14",62.6,null],[2025,"ATL","8–9",75.3,null],[2025,"BAL","8–9",86.4,null],[2025,"BUF","12–5",99.8,112.3],[2025,"CAR","8–9",72.2,101.5],[2025,"CHI","11–6",86.4,107.0],[2025,"CIN","6–11",70.8,null],[2025,"CLE","5–12",67.6,null],[2025,"DAL","7–9–1",76.5,null],[2025,"DEN","14–3",95.9,110.8],[2025,"DET","9–8",92.7,null],[2025,"GB","9–7–1",87.1,107.3],[2025,"HOU","12–5",98.8,111.9],[2025,"IND","8–9",90.6,null],[2025,"JAX","13–4",103.1,113.5],[2025,"KC","6–11",87.6,null],[2025,"LA","12–5",108.2,115.5],[2025,"LAC","11–6",86.7,107.2],[2025,"LV","3–14",54.0,null],[2025,"MIA","7–10",71.0,null],[2025,"MIN","9–8",84.1,null],[2025,"NE","14–3",107.9,115.4],[2025,"NO","6–11",71.0,null],[2025,"NYG","4–13",73.8,null],[2025,"NYJ","3–14",52.2,null],[2025,"PHI","11–6",90.6,108.7],[2025,"PIT","10–7",84.0,106.1],[2025,"SEA","14–3",111.0,116.6],[2025,"SF","12–5",92.4,109.4],[2025,"TB","8–9",77.9,null],[2025,"TEN","3–14",53.5,null],[2025,"WAS","5–12",68.3,null]]; // [season, team, record, regular-season strength, playoff strength]

const WINDOWS = [[1999, 2005], [2006, 2010], [2011, 2015], [2016, 2020], [2021, 2025]];
const POS = ["QB", "RB", "WR", "TE"];
const POS_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };
const SLOTS = ["QB", "RB", "WR", "TE", "FLEX1", "FLEX2"];
const SLOT_LABEL = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX1: "Flex", FLEX2: "Flex" };
// Stats O/U: the one headline counting stat each position gets quizzed on.
const SOU_STAT = {
  QB: ["py", "passing yards"],
  RB: ["ry", "rushing yards"],
  WR: ["rcy", "receiving yards"],
  TE: ["rcy", "receiving yards"],
};
const QB_WEIGHT = 1.25;
// Build-a-player: roll a real player at the assigned position, take exactly one of these raw
// stats from him, repeat until every category is filled, then the assembled player fills that
// position's slot for a normal draft. Only raw counting stats (not derived ones like yds/carry
// or QB rating) are pickable, since those can't be assembled piecemeal.
const BUILD_CATEGORIES = {
  QB: [["py", "Pass yards"], ["ptd", "Pass TD"], ["int", "INT"], ["ry", "Rush yards"]],
  RB: [["ry", "Rush yards"], ["rtd", "Rush TD"], ["rec", "Receptions"], ["rcy", "Rec yards"]],
  WR: [["rcy", "Rec yards"], ["rctd", "Rec TD"], ["rec", "Receptions"], ["ry", "Rush yards"]],
  TE: [["rcy", "Rec yards"], ["rctd", "Rec TD"], ["rec", "Receptions"], ["fl", "Fumbles lost"]],
};

const TEAMS = {
  ARI: ["Cardinals", "Arizona", "#97233F", "#FFB612"], ATL: ["Falcons", "Atlanta", "#A71930", "#1B1B1B"],
  BAL: ["Ravens", "Baltimore", "#241773", "#9E7C0C"], BUF: ["Bills", "Buffalo", "#00338D", "#C60C30"],
  CAR: ["Panthers", "Carolina", "#0085CA", "#101820"], CHI: ["Bears", "Chicago", "#0B162A", "#C83803"],
  CIN: ["Bengals", "Cincinnati", "#FB4F14", "#1B1B1B"], CLE: ["Browns", "Cleveland", "#311D00", "#FF3C00"],
  DAL: ["Cowboys", "Dallas", "#003594", "#869397"], DEN: ["Broncos", "Denver", "#FB4F14", "#002244"],
  DET: ["Lions", "Detroit", "#0076B6", "#B0B7BC"], GB: ["Packers", "Green Bay", "#203731", "#FFB612"],
  HOU: ["Texans", "Houston", "#03202F", "#A71930"], IND: ["Colts", "Indianapolis", "#002C5F", "#A2AAAD"],
  JAX: ["Jaguars", "Jacksonville", "#006778", "#D7A22A"], KC: ["Chiefs", "Kansas City", "#E31837", "#FFB81C"],
  LA: ["Rams", "Los Angeles", "#003594", "#FFD100"], LAC: ["Chargers", "Los Angeles", "#0080C6", "#FFC20E"],
  LV: ["Raiders", "Las Vegas", "#1B1B1B", "#A5ACAF"], MIA: ["Dolphins", "Miami", "#008E97", "#FC4C02"],
  MIN: ["Vikings", "Minnesota", "#4F2683", "#FFC62F"], NE: ["Patriots", "New England", "#002244", "#C60C30"],
  NO: ["Saints", "New Orleans", "#A08A58", "#101820"], NYG: ["Giants", "New York", "#0B2265", "#A71930"],
  NYJ: ["Jets", "New York", "#125740", "#FFFFFF"], PHI: ["Eagles", "Philadelphia", "#004C54", "#A5ACAF"],
  PIT: ["Steelers", "Pittsburgh", "#FFB612", "#101820"], SEA: ["Seahawks", "Seattle", "#002244", "#69BE28"],
  SF: ["49ers", "San Francisco", "#AA0000", "#B3995D"], TB: ["Buccaneers", "Tampa Bay", "#D50A0A", "#34302B"],
  TEN: ["Titans", "Tennessee", "#0C2340", "#4B92DB"], WAS: ["Washington", "", "#5A1414", "#FFB612"],
};
const teamVars = (code) => ({ "--tc1": TEAMS[code][2], "--tc2": TEAMS[code][3] });
const gradeTier = (r) => (r >= 95 ? "ga" : r >= 80 ? "gb" : r >= 56 ? "gc" : "gd");
const TEAM_CODES = Object.keys(TEAMS);

function cityFor(code, year) {
  if (code === "LA") return year <= 2015 ? "St. Louis" : "Los Angeles";
  if (code === "LAC") return year <= 2016 ? "San Diego" : "Los Angeles";
  if (code === "LV") return year <= 2019 ? "Oakland" : "Las Vegas";
  return TEAMS[code][1];
}
function cityRange(code, w) {
  const [a, b] = WINDOWS[w];
  const c1 = cityFor(code, a), c2 = cityFor(code, b);
  return c1 === c2 ? c1 : `${c1} & ${c2}`;
}
function teamLabel(code, year) {
  const c = cityFor(code, year);
  return c ? `${c} ${TEAMS[code][0]}` : TEAMS[code][0];
}

// Parse compact data into player objects
const BOARDS = {};
for (const [key, arr] of Object.entries(DATA.b)) {
  const [team, w] = key.split("|");
  BOARDS[key] = arr.map((e) => ({
    id: e[0], name: DATA.n[e[0]], pos: POS[e[1]], season: e[2], g: e[3],
    cmp: e[4], att: e[5], py: e[6], ptd: e[7], int: e[8],
    car: e[9], ry: e[10], rtd: e[11], rec: e[12], rcy: e[13], rctd: e[14],
    fl: e[15], ppr: e[16], rating: e[17], team, w: Number(w),
  })).sort((x, y) => {
    const lx = x.name.split(" ").slice(1).join(" ") || x.name;
    const ly = y.name.split(" ").slice(1).join(" ") || y.name;
    return lx.localeCompare(ly);
  });
}
// Every player id that actually appears on a board, for Stats O/U's random pick - DATA.n (the
// id->name lookup) may include ids that never qualified for any board, so sampling from it
// directly risks never landing on a usable one.
const SOU_PLAYER_IDS = [...new Set(Object.values(BOARDS).flat().map((p) => p.id))];

// Flex slots score on raw production alone, not position-relative grading: `rating` grades
// RB/WR/TE against their OWN position's peers, so a modest-for-a-WR season can outrank a
// dominant-for-a-TE season even though the TE outproduced everyone at his own spot - fine for
// the named slots, wrong for a slot that's explicitly position-agnostic. Renormalize ppr
// across the combined RB/WR/TE pool per era window, then rescale onto the numeric range
// `rating` already occupies for that same combined pool, so team-score math (calibrated
// against opponent difficulty on the rating scale) doesn't need to change - only which
// player comes out on top for a Flex spot.
const FLEX_POS = ["RB", "WR", "TE"];
const flexStatsByEra = WINDOWS.map((_, w) => {
  const pool = [];
  for (const key of Object.keys(BOARDS)) {
    if (Number(key.split("|")[1]) !== w) continue;
    for (const p of BOARDS[key]) if (FLEX_POS.includes(p.pos)) pool.push(p);
  }
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const std = (xs, m) => Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) || 1;
  const pprMean = mean(pool.map((p) => p.ppr));
  const ratingMean = mean(pool.map((p) => p.rating));
  return {
    pprMean, pprStd: std(pool.map((p) => p.ppr), pprMean),
    ratingMean, ratingStd: std(pool.map((p) => p.rating), ratingMean),
  };
});
function flexRating(p) {
  const s = flexStatsByEra[p.w];
  return s.ratingMean + ((p.ppr - s.pprMean) / s.pprStd) * s.ratingStd;
}
// The rating a player should count as in team-score math for the slot they're in: their
// normal positional grade for a named slot, or their stats-only flexRating for a Flex spot.
function effectiveRating(slot, p) {
  return slot.startsWith("FLEX") ? flexRating(p) : p.rating;
}

// ---------- GM mode (salary cap) ----------
// No real salary data exists, so this derives a price from the player's own positional rating
// - a player costs what he costs regardless of which slot (named or Flex) ends up using him,
// same as a real contract doesn't change based on where he lines up on a given play. Curved
// rather than linear so elite seasons cost more per rating point than average ones, but capped
// low enough that even the best single season in the game (rating ~120) tops out around a
// quarter of GM_CAP - one all-timer shouldn't eat half your budget by itself.
const GM_CAP = 150; // in $M, for a 6-man "roster"
function playerSalary(p) {
  const r = Math.max(0, p.rating - 35);
  return Math.max(1, Math.round(0.0055 * r * r));
}

// Seeded randomness, so a daily or a challenge code gives everyone the same draft.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const newCode = () => Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const prettyDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
};

// The draft sequence for a seed: six boards plus alternates for re-spins, with no repeated
// team and no era more than twice.
function seededSequence(seed) {
  const rng = mulberry32(hashStr(seed));
  const all = Object.keys(BOARDS);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const out = [], teams = new Set(), eras = {};
  for (const key of all) {
    const [t, w] = key.split("|");
    if (teams.has(t) || (eras[w] || 0) >= 2) continue;
    out.push(key); teams.add(t); eras[w] = (eras[w] || 0) + 1;
    if (out.length >= 18) break;
  }
  return out;
}

const fits = (pos, slot) => (slot.startsWith("FLEX") ? pos !== "QB" : slot === pos);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function boardHasOption(key, drafted, open) {
  const b = BOARDS[key];
  return !!b && b.some((p) => !drafted.has(p.id) && open.some((s) => fits(p.pos, s)));
}

function passerRating(p) {
  if (!p.att) return 0;
  const c = (x) => Math.max(0, Math.min(2.375, x));
  const a = c((p.cmp / p.att - 0.3) * 5), b = c((p.py / p.att - 3) * 0.25);
  const t = c((p.ptd / p.att) * 20), d = c(2.375 - (p.int / p.att) * 25);
  return ((a + b + t + d) / 6) * 100;
}

// Every player at a position shows the same stat columns, in the same order.
// Same shape at every position: main-role yards, TDs, per-attempt average, then volume,
// then the secondary role, then fumbles.
function statCells(p) {
  const n = (v) => v.toLocaleString();
  const ypc = p.car ? (p.ry / p.car).toFixed(1) : "–";
  const ypr = p.rec ? (p.rcy / p.rec).toFixed(1) : "–";
  if (p.pos === "QB") return [
    [n(p.py), "Pass yds"], [p.ptd, "Pass TD"], [p.int, "INT"],
    [p.att ? ((100 * p.cmp) / p.att).toFixed(1) + "%" : "–", "Comp %"], [p.att ? passerRating(p).toFixed(1) : "–", "QB rating"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"],
  ];
  if (p.pos === "TE") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"], [p.fl, "Fum lost"],
  ];
  if (p.pos === "WR") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [p.fl, "Fum lost"],
  ];
  return [
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [ypc, "Yds/carry"], [p.rec, "Rec"],
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [p.fl, "Fum lost"],
  ];
}

function grade(r) {
  const t = [[120, "A+"], [105, "A"], [95, "A−"], [88, "B+"], [80, "B"], [72, "B−"], [64, "C+"], [56, "C"], [48, "C−"], [40, "D"]];
  for (const [v, g] of t) if (r >= v) return g;
  return "F";
}

// ---------- Season simulation ----------
const LOSER_PTS = [0, 3, 6, 7, 9, 10, 10, 13, 13, 14, 16, 17, 17, 20, 20, 21, 23, 24, 27];
const MARGINS = [1, 2, 3, 3, 3, 4, 5, 6, 7, 7, 7, 8, 10, 10, 11, 13, 14, 14, 17, 21];
// Difficulty. Opponents are on the same scale as your team score.
// Win probability scales linearly with the score gap and is fully deterministic (0% or 100%)
// once the gap passes SPREAD - a real lead should basically never be upset, rather than
// carrying a small forever-upset chance no matter how dominant the team is (the old sigmoid
// approached but never reached certainty). Smaller SPREAD = fewer upsets, more linear/decisive.
const SPREAD = 20;
const winProb = (s, o) => Math.max(0, Math.min(1, 0.5 + (s - o) / (2 * SPREAD)));

function gameResult(s, o) {
  const win = Math.random() < winProb(s, o);
  const lo = pick(LOSER_PTS);
  let m = pick(MARGINS);
  if (win && s - o > 15 && Math.random() < 0.5) m = pick([14, 17, 21, 24, 28]);
  if (lo === 0 && m < 3) m = 3; // no 1–0 or 2–0 finals
  return win ? { win, us: lo + m, them: lo } : { win, us: lo, them: lo + m };
}

// Real opponents: every 1999–2025 team-season, rated from its actual point differential
// on the same scale as your team score. Playoff strength only exists for teams that made the playoffs.
const OPPS = OPP_DATA.map(([season, team, rec, reg, po]) => ({ season, team, rec, reg, po }));
const PLAYOFF_OPPS = OPPS.filter((o) => o.po != null);
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// Shuffles only within fixed-size windows, so the array keeps its overall order (weakest to
// strongest) while still varying week to week within each window - a schedule ramp, not a
// hard ladder.
const windowedShuffle = (a, windowSize) => {
  const b = [...a];
  for (let start = 0; start < b.length; start += windowSize) {
    const end = Math.min(start + windowSize, b.length);
    for (let i = end - 1; i > start; i--) {
      const j = start + Math.floor(Math.random() * (i - start + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
  }
  return b;
};
function tagOpp(g, o) {
  g.opp = `${o.season} ${TEAMS[o.team][0]}`;
  g.oppShort = TEAMS[o.team][0];
  g.oppRec = o.rec;
  g.oppTeam = o.team;
  return g;
}

// Runs fn with Math.random replaced by a seeded generator. The sim is synchronous, so
// nothing else can draw from it in the meantime.
function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = mulberry32(hashStr(seed));
  try { return fn(); } finally { Math.random = real; }
}

function simulateSeason(score) {
  const games = [];
  // Same random 17-team draw as before, just reordered so difficulty trends easy-to-hard
  // across the season instead of pure random placement - a strong team's rare loss should
  // come late against a real threat, not out of nowhere in week 2.
  const drawn = shuffle(OPPS).slice(0, 17);
  const schedule = windowedShuffle([...drawn].sort((a, b) => a.reg - b.reg), 5);
  const usedOpp = new Set(schedule);
  let w = 0, l = 0;
  schedule.forEach((o, i) => {
    const g = tagOpp(gameResult(score, o.reg), o);
    g.label = `Wk ${i + 1}`;
    g.home = Math.random() < 0.5;
    games.push(g);
    g.win ? w++ : l++;
  });
  let outcome;
  if (w < 10) {
    outcome = "Missed the playoffs";
  } else {
    const rounds = w >= 13 ? ["Divisional", "Conference", "Championship"] : ["Wild Card", "Divisional", "Conference", "Championship"];
    // Playoff opponents get tougher each round. Draw a wide field before banding by round
    // (rather than sorting a tiny 3-4 team sample) so the same handful of extreme dynasty
    // teams don't end up as the championship opponent every time - just because a team is the
    // toughest of a tiny random sample doesn't mean it should always be the same few teams.
    const CANDIDATE_POOL_SIZE = 12;
    const remaining = shuffle(PLAYOFF_OPPS.filter((o) => !usedOpp.has(o)));
    const sample = remaining.slice(0, Math.min(CANDIDATE_POOL_SIZE, remaining.length)).sort((x, y) => x.po - y.po);
    const field = rounds.map((_, i) => {
      const lo = Math.floor((i / rounds.length) * sample.length);
      const hi = Math.floor(((i + 1) / rounds.length) * sample.length);
      const band = sample.slice(lo, Math.max(hi, lo + 1));
      return band[Math.floor(Math.random() * band.length)];
    });
    outcome = null;
    for (let i = 0; i < rounds.length; i++) {
      const g = tagOpp(gameResult(score, field[i].po), field[i]);
      g.label = rounds[i];
      g.playoff = true;
      g.plays = buildTimeline(g.us, g.them, g.win);
      games.push(g);
      if (g.win) w++;
      else { l++; outcome = `Lost to the ${g.opp} in the ${rounds[i].toLowerCase()} round`; break; }
    }
    if (!outcome) outcome = w === 20 ? "Perfect season. 20–0." : `Won the championship after a ${w - rounds.length}–${l} regular season`;
  }
  const playoffs = games.some((g) => g.playoff);
  const champ = playoffs && games[games.length - 1].label === "Championship" && games[games.length - 1].win;
  return { games, w, l, outcome, playoffs, champ, perfect: w === 20 && l === 0 };
}

// ---------- Admin testing tools ----------
// Same scoring shape as gameResult, but the win/loss is dictated rather than rolled - lets the
// admin panel jump straight to a specific season outcome to check its ending animation/banner.
function forcedGameResult(win) {
  const lo = pick(LOSER_PTS);
  let m = pick(MARGINS);
  if (lo === 0 && m < 3) m = 3;
  return win ? { win, us: lo + m, them: lo } : { win, us: lo, them: lo + m };
}
const FORCED_SCENARIOS = {
  perfect: { regWins: 17, rounds: ["Divisional", "Conference", "Championship"], loseRound: null },
  champ: { regWins: 15, rounds: ["Wild Card", "Divisional", "Conference", "Championship"], loseRound: null },
  lostWildCard: { regWins: 10, rounds: ["Wild Card", "Divisional", "Conference", "Championship"], loseRound: 0 },
  lostDivisional: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 0 },
  lostConference: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 1 },
  lostChampionship: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 2 },
  missedPlayoffs: { regWins: 7, rounds: [], loseRound: null },
};
function forceSeason(scenarioKey) {
  const cfg = FORCED_SCENARIOS[scenarioKey];
  const games = [];
  const regOpps = shuffle(OPPS).slice(0, 17);
  let w = 0, l = 0;
  regOpps.forEach((o, i) => {
    const win = i < cfg.regWins;
    const g = tagOpp(forcedGameResult(win), o);
    g.label = `Wk ${i + 1}`;
    g.home = Math.random() < 0.5;
    games.push(g);
    win ? w++ : l++;
  });
  let outcome;
  if (!cfg.rounds.length) {
    outcome = "Missed the playoffs";
  } else {
    const poOpps = shuffle(PLAYOFF_OPPS).slice(0, cfg.rounds.length);
    outcome = null;
    for (let i = 0; i < cfg.rounds.length; i++) {
      const win = cfg.loseRound === null || i < cfg.loseRound;
      const g = tagOpp(forcedGameResult(win), poOpps[i]);
      g.label = cfg.rounds[i];
      g.playoff = true;
      g.plays = buildTimeline(g.us, g.them, g.win);
      games.push(g);
      if (win) w++;
      else { l++; outcome = `Lost to the ${g.opp} in the ${cfg.rounds[i].toLowerCase()} round`; break; }
    }
    if (!outcome) outcome = w === 20 ? "Perfect season. 20–0." : `Won the championship after a ${w - cfg.rounds.length}–${l} regular season`;
  }
  const playoffs = games.some((g) => g.playoff);
  const champ = playoffs && games[games.length - 1].label === "Championship" && games[games.length - 1].win;
  return { games, w, l, outcome, playoffs, champ, perfect: w === 20 && l === 0 };
}
// Case-insensitive substring search for the admin "force a player" tool, across every board.
function adminSearchPlayers(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const key of Object.keys(BOARDS)) {
    for (const p of BOARDS[key]) {
      if (p.name.toLowerCase().includes(q)) {
        results.push(p);
        if (results.length >= 8) return results;
      }
    }
  }
  return results;
}

// ---------- Playoff game timeline ----------
// Break a final score into scoring plays: TD 7, FG 3, TD + two-point try 8, TD with missed PAT 6, safety 2.
// Safeties only show up when nothing else can make the number (2, 4, 5).
function scoringPlays(n) {
  const reach = (k) => k === 0 || k === 3 || k >= 6;
  const out = [];
  while (n > 0) {
    const c = [[7, 5], [3, 3], [8, 0.4], [6, 0.4]].filter(([v]) => v <= n && reach(n - v));
    if (!c.length) { out.push(2); n -= 2; continue; }
    let r = Math.random() * c.reduce((a, [, w]) => a + w, 0);
    for (const [v, w] of c) { if ((r -= w) <= 0) { out.push(v); n -= v; break; } }
  }
  return out;
}
function buildTimeline(us, them, win) {
  const plays = [
    ...scoringPlays(us).map((v) => ({ team: "us", v })),
    ...scoringPlays(them).map((v) => ({ team: "them", v })),
  ].sort(() => Math.random() - 0.5);
  const close = Math.abs(us - them) <= 8;
  if (close && plays.length) {
    // close game: the winner gets the last score (a real drive, not a safety), late in the fourth
    const w = win ? "us" : "them";
    let li = -1;
    plays.forEach((p, i) => { if (p.team === w && p.v !== 2) li = i; });
    if (li >= 0) { const [p] = plays.splice(li, 1); plays.push(p); }
  }
  // spread scores out with at least ~2.5 game minutes between them
  const n = plays.length, GAP = 2.5;
  const lastFixed = close && n ? 57.2 + Math.random() * 2.4 : null;
  const end = lastFixed ? lastFixed - GAP : 58.5;
  const m = lastFixed ? n - 1 : n;
  const room = Math.max(0, end - 1.5 - (m - 1) * GAP);
  const base = Array.from({ length: m }, () => Math.random() * room).sort((a, b) => a - b);
  base.forEach((b, i) => { plays[i].time = Math.round((1.5 + b + i * GAP) * 60) / 60; });
  if (lastFixed) plays[n - 1].time = Math.round(lastFixed * 60) / 60;
  return plays;
}
// ---------- Playoff game script ----------
// A game is a list of drives. Positions are yards from the possessing team's own goal line (0-100).
// Scoring drives end exactly at their scoring play's time; everything else is filled with punts.
const rnd = (a, b) => a + Math.random() * (b - a);
const other = (team) => (team === "us" ? "them" : "us");
function buildDrives(plays) {
  const drives = [];
  let t = 0, poss = Math.random() < 0.5 ? "us" : "them", start = 25;
  const filler = (until) => {
    while (until - t > 3.5) {
      const len = Math.min(until - t - 1.5, rnd(4, 7.5));
      const end = Math.round(Math.min(68, start + rnd(6, 38)));
      const landing = end + rnd(36, 48); // punt lands here, in the punting team's yards
      drives.push({ team: poss, t0: t, t1: t + len, y0: start, y1: end, landing });
      t += len;
      start = landing >= 98 ? 20 : Math.max(5, Math.round(100 - landing));
      poss = other(poss);
    }
  };
  for (const p of plays) {
    filler(p.time - 2);
    const team = p.v === 2 ? other(p.team) : p.team; // a safety happens to the team with the ball
    if (poss !== team && p.time - t >= 2.6 && Math.random() < 0.6) {
      // wrong team has the ball and there's time: they go three-and-out and punt
      const end = Math.round(Math.min(45, start + rnd(-3, 8)));
      const landing = end + rnd(38, 46);
      drives.push({ team: poss, t0: t, t1: t + 1.4, y0: start, y1: end, landing });
      t += 1.4;
      start = landing >= 98 ? 20 : Math.max(5, Math.round(100 - landing));
      poss = team;
    }
    if (poss !== team) {
      // still the wrong team: a quick turnover hands it over (often a short field)
      const len = Math.max(0.4, Math.min(1.2, (p.time - t) / 3));
      const y1 = Math.round(Math.min(70, start + rnd(0, 14)));
      drives.push({ team: poss, t0: t, t1: t + len, y0: start, y1, turnover: Math.random() < 0.55 ? "Interception" : "Fumble" });
      t += len;
      start = Math.round(Math.max(15, Math.min(70, 100 - y1 - rnd(0, 12))));
      poss = team;
    }
    if (p.v === 2) start = Math.round(rnd(3, 9));
    const y1 = p.v === 3 ? Math.round(Math.min(85, Math.max(rnd(62, 80), start + rnd(4, 12)))) : p.v === 2 ? 0 : 100; // field goal drives always gain ground
    drives.push({ team, t0: t, t1: p.time, y0: start, y1, play: p });
    t = p.time; start = 25;
    poss = other(p.team); // the team that was scored on receives (after a safety, the scoring team does)
  }
  filler(60);
  if (t < 60) drives.push({ team: poss, t0: t, t1: 60, y0: start, y1: Math.min(70, start + 12) });
  return drives;
}

const lastName = (n) => n.split(" ").slice(1).join(" ") || n;
function weighted(list) {
  let r = Math.random() * list.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[0][0];
}
function playText(team, gain, td, cast, opp) {
  const pass = gain < 0 ? Math.random() < 0.6 : gain >= 20 ? Math.random() < 0.8 : Math.random() < 0.55;
  const yds = Math.abs(gain);
  if (team === "them") {
    if (td) return `${opp} ${yds}-yd TD ${pass ? "pass" : "run"}`;
    if (gain < 0) return pass ? `${opp} QB sacked, loss of ${yds}` : `${opp} run stopped for a loss of ${yds}`;
    if (gain === 0) return `${opp} pass incomplete`;
    return `${opp} ${yds}-yd ${pass ? "pass" : "run"}`;
  }
  const qb = cast.qb, runner = weighted(cast.runners), target = weighted(cast.targets);
  if (td) return pass ? `${qb} ${yds}-yd TD pass to ${target}` : `${runner} ${yds}-yd TD run`;
  if (gain < 0) return pass ? `${qb} sacked, loss of ${yds}` : `${runner} stopped for a loss of ${yds}`;
  if (gain === 0) return `${qb} incomplete to ${target}`;
  return pass ? `${qb} ${yds}-yd pass to ${target}` : `${runner} ${yds}-yd run`;
}
function castFrom(roster) {
  const all = Object.entries(roster || {});
  const qb = roster && roster.QB ? lastName(roster.QB.name) : "Your QB";
  const runners = all.filter(([, p]) => p.pos === "RB").map(([s, p]) => [lastName(p.name), s === "RB" ? 3 : 1]);
  const targets = all.filter(([, p]) => p.pos !== "QB").map(([, p]) => [lastName(p.name), p.pos === "WR" ? 3 : p.pos === "TE" ? 2 : 1]);
  return { qb, runners: runners.length ? runners : [["Your RB", 1]], targets: targets.length ? targets : [["your receiver", 1]] };
}
const PLAY_NAME = { 7: "touchdown", 3: "field goal", 8: "touchdown + 2-pt conversion", 6: "touchdown, PAT missed", 2: "safety" };
const QUARTER_BREAKS = [[15, "End of the 1st quarter"], [30, "Halftime"], [45, "End of the 3rd quarter"]];

// Turn drives into a paced list of events. Each event is one moment on screen:
// a big play, a punt, a score, a touchback, or a quarter break. dur is real milliseconds.
function buildScript(game, roster) {
  const cast = castFrom(roster);
  const opp = game.oppShort || game.opp;
  const teamName = (tm) => (tm === "us" ? "Your team" : opp);
  const ballAt = (tm, own) => `${teamName(tm)} ball at ${own < 50 ? (tm === "us" ? "your own " : "their own ") + own : own === 50 ? "midfield" : tm === "us" ? `the ${opp} ${100 - own}` : `your ${100 - own}`}`;
  const drives = buildDrives(game.plays || []);
  const ev = [{ t: 0, team: drives[0] ? drives[0].team : "us", own: 25, from: 25, kind: "reset", text: "Kickoff. Touchback", dur: 700 }];
  let us = 0, them = 0;
  drives.forEach((d, di) => {
    const kind = d.play ? (d.play.v === 3 ? "fg" : d.play.v === 2 ? "safety" : "td") : d.turnover ? "tov" : di === drives.length - 1 ? "end" : "punt";
    const long = d.y1 - d.y0 > 55;
    const n = kind === "td" ? (long ? 3 : 2) + (Math.random() < 0.3 ? 1 : 0) : kind === "fg" ? 2 : 1;
    const yEnd = d.y1;
    const w = Array.from({ length: n }, () => 0.35 + Math.random());
    const tot = w.reduce((a, b) => a + b, 0);
    let cum = 0, at = d.y0;
    const slots = kind === "td" || kind === "safety" ? n : n + 1;
    for (let i = 0; i < n; i++) {
      cum += w[i];
      let yard = i === n - 1 ? yEnd : Math.round(d.y0 + ((yEnd - d.y0) * cum) / tot);
      if (kind === "punt" && Math.random() < 0.15 && i === 0) yard = Math.max(1, at - Math.round(rnd(2, 7))); // occasional loss
      const t = d.t0 + ((d.t1 - d.t0) * (i + 1)) / slots;
      const close = t >= 54 && Math.abs(us - them) <= 8;
      const td = kind === "td" && i === n - 1;
      const text = kind === "safety" ? `${d.team === "us" ? cast.qb : opp + " QB"} tackled in the end zone` : playText(d.team, yard - at, td, cast, opp);
      ev.push({ t, team: d.team, own: yard, from: d.y0, kind: "play", text, dur: close ? 850 : kind === "td" || kind === "fg" ? 470 : 330 });
      at = yard;
    }
    if (d.play) {
      const p = d.play;
      if (p.team === "us") us += p.v; else them += p.v;
      const fgText = `${100 - at + 17}-yd field goal is good`;
      ev.push({ t: d.t1, team: d.team, own: at, from: d.y0, kind: "score", play: p, dur: 1250,
        text: p.v === 3 ? `${teamName(p.team)}: ${fgText}` : p.v === 2 ? `Safety. 2 points for ${teamName(p.team).toLowerCase() === "your team" ? "your team" : opp}` : `${teamName(p.team)} ${PLAY_NAME[p.v]}`,
        flash: p.team === "us" ? `${PLAY_NAME[p.v][0].toUpperCase()}${PLAY_NAME[p.v].slice(1)}!` : `${opp} ${PLAY_NAME[p.v]}` });
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "reset", text: `Kickoff. ${ballAt(next.team, next.y0)}`, dur: 380 });
    } else if (kind === "punt") {
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "punt",
        text: `${teamName(d.team)} punts.${d.landing >= 98 ? " Touchback." : ""} ${ballAt(next.team, next.y0)}`, dur: 520 });
    } else if (kind === "tov") {
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "turnover", dur: 1100,
        text: `${d.turnover}! ${ballAt(next.team, next.y0)}`,
        flash: next.team === "us" ? `${d.turnover}!` : `${opp} ${d.turnover.toLowerCase()}`, mine: next.team === "us" });
    }
  });
  // quarter breaks go in front of the first event past each break
  const out = [];
  let bi = 0;
  for (const e of ev) {
    while (bi < QUARTER_BREAKS.length && e.t > QUARTER_BREAKS[bi][0]) {
      const prev = out[out.length - 1];
      out.push({ ...prev, t: QUARTER_BREAKS[bi][0], kind: "break", flash: QUARTER_BREAKS[bi][1], text: prev.text, dur: 750, mine: false });
      bi++;
    }
    out.push(e);
  }
  // keep every game around 25-30 seconds: squeeze the in-between plays first, then the banners
  const TARGET = 24000;
  const isBanner = (x) => x.kind === "score" || x.kind === "turnover" || x.kind === "break";
  const bannerMs = out.filter(isBanner).reduce((a, x) => a + x.dur, 0);
  const moveMs = out.filter((x) => !isBanner(x)).reduce((a, x) => a + x.dur, 0);
  if (bannerMs + moveMs > TARGET) {
    const f = Math.max(0.5, (TARGET - bannerMs) / moveMs);
    out.forEach((x) => { if (!isBanner(x)) x.dur = Math.round(x.dur * f); });
    const left = TARGET - out.filter((x) => !isBanner(x)).reduce((a, x) => a + x.dur, 0);
    if (bannerMs > left) out.forEach((x) => { if (isBanner(x)) x.dur = Math.max(850, Math.round((x.dur * left) / bannerMs)); });
  }
  // never rush a moment: the ball needs time to land before the next one
  const MIN = { play: 370, punt: 680, reset: 420 };
  out.forEach((x) => { if (MIN[x.kind]) x.dur = Math.max(MIN[x.kind], x.dur); });
  return out;
}

function clockLabel(t) {
  if (t >= 60) return ["Final", ""];
  const q = Math.min(4, Math.floor(t / 15) + 1);
  const rem = Math.max(0, 15 - (t - (q - 1) * 15));
  let m = Math.floor(rem), s = Math.round((rem - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return [`Q${q}`, `${m}:${String(s).padStart(2, "0")}`];
}

function PlayoffGame({ game, roster, instant, onFinal, footer }) {
  const script = useMemo(() => buildScript(game, roster), [game]);
  const [i, setI] = useState(instant ? script.length : 0);
  const reported = useRef(false);
  const done = i >= script.length;
  const e = done ? script[script.length - 1] : script[i];

  useEffect(() => {
    if (done && !reported.current) { reported.current = true; onFinal(); }
  }, [done]);
  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setI((x) => x + 1), script[i].dur);
    return () => clearTimeout(id);
  }, [i, done]);

  const shownEvents = done ? script : script.slice(0, i + 1);
  const scores = shownEvents.filter((x) => x.kind === "score");
  const us = done ? game.us : scores.filter((x) => x.play.team === "us").reduce((a, x) => a + x.play.v, 0);
  const them = done ? game.them : scores.filter((x) => x.play.team === "them").reduce((a, x) => a + x.play.v, 0);
  const t = done ? 60 : e.t;
  const [q, clk] = clockLabel(t);
  const toScreen = (team, own) => (team === "us" ? own : 100 - own);
  const ball = toScreen(e.team, e.own);
  const from = toScreen(e.team, e.from);
  const segment = shownEvents.filter((x) => x.kind === "reset" || x.kind === "turnover").length; // new ball after kickoffs and turnovers, no sliding
  const flash = !done && (e.kind === "score" || e.kind === "break" || e.kind === "turnover") ? e.flash : null;
  const flashMine = e.kind === "score" ? e.play.team === "us" : !!e.mine;
  const own = e.own;
  const yd = (v) => Math.max(1, Math.round(v));
  const spot = own < 49.5 ? `own ${yd(own)}` : own <= 50.5 ? "midfield" : e.team === "us" ? `${game.oppShort || game.opp} ${yd(100 - own)}` : `your ${yd(100 - own)}`;
  const redZone = own >= 80 && own < 100;
  const log = scores.slice(-3).reverse();
  const showTrail = !done && e.kind === "play";

  return (
    <div className="pg" aria-live="polite">
      <div className="pg-top"><span>{game.label} round vs {game.opp} ({game.oppRec})</span><span>{done ? (game.win ? "You advance" : "Season over") : "Live"}</span></div>
      <div className="sb">
        <div className={`side ${us > them ? "lead" : ""}`}><div className="tm">Your team</div><div className="pts led-wrap"><span className="led">{us}</span></div></div>
        <div className="clock">{q}<small>{clk}</small></div>
        <div className={`side r ${them > us ? "lead" : ""}`}><div className="tm">{game.oppShort || game.opp}</div><div className="pts led-wrap"><span className="led">{them}</span></div></div>
      </div>
      <div className="field" aria-hidden="true">
        <div className="ez l" style={game.oppTeam ? { background: TEAMS[game.oppTeam][2], color: "rgba(255,255,255,.8)" } : undefined}>{game.oppShort || game.opp}</div>
        <div className="yards"><span className="fifty">50</span>
          {showTrail && <span className={`trail ${e.team === "us" ? "mine" : ""}`} style={{ left: `${Math.min(from, ball)}%`, width: `${Math.abs(ball - from)}%` }} />}
          {!done && <span key={segment} className={`ball ${e.team === "us" ? "mine" : ""} ${e.kind === "punt" ? "air" : ""}`} style={{ left: `${Math.max(0, Math.min(100, ball))}%` }} />}
        </div>
        <div className="ez r">You</div>
        {flash && <div className={`flash ${flashMine ? "mine" : ""}`}>{flash}</div>}
      </div>
      {!done && (
        <div className="pbp">
          <div className="now">{e.text}</div>
          {e.kind === "play" && <div className={`spot ${redZone ? "rz" : ""}`}>{e.team === "us" ? "Your ball" : `${game.oppShort || game.opp} ball`}, {spot}{redZone ? ". Red zone" : ""}</div>}
        </div>
      )}
      <div className="plog">
        {log.length === 0 ? <span>No score yet.</span> : log.map((x, k) => {
          const [pq, pc] = clockLabel(x.t);
          return <div key={k}>{pq} {pc} {x.text}</div>;
        })}
      </div>
      {!done && <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => setI(script.length)}>Skip to the final score</button>}
      {done && <div className="pfinal"><div className={`fin ${game.win ? "w" : "l"}`}>{game.win ? "Win" : "Loss"}, {game.us}–{game.them}</div>{footer}</div>}
    </div>
  );
}

// ---------- Styles ----------
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap');
.ps{--display:'Big Shoulders Display','Barlow Condensed','Arial Narrow',Impact,sans-serif;--bg:#14211B;--surface:#1B2B23;--surface2:#22362C;--line:#2C4337;--line2:#3A5546;--ink:#E9F0EB;--muted:#93A89B;--lamp:#F5B324;--board:#0E1713;--win:#6FD49B;--loss:#F07B6B;--lampsoft:rgba(245,179,36,.13);
  font-family:'Barlow',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;font-variant-numeric:tabular-nums;}
.ps *{box-sizing:border-box}
.ps button{font-family:inherit;cursor:pointer}
.ps button:focus-visible{outline:3px solid var(--lamp);outline-offset:2px}
.wrap{max-width:880px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.title{font-family:var(--display);font-weight:900;font-size:44px;line-height:.9;letter-spacing:-.5px;margin:0;color:var(--ink)}
.sub{margin:6px 0 0;color:var(--muted);font-size:15px;max-width:46ch}
.best{text-align:right;font-size:13px;color:var(--muted);white-space:nowrap}
.best b{display:block;font-family:var(--display);font-weight:800;font-size:26px;color:var(--ink)}
.roster{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:12px}
.slot{border:1.5px dashed var(--line2);border-radius:8px;padding:7px 9px;min-height:58px;background:transparent;text-align:left;color:var(--ink)}
.slot .k{font-weight:700;font-size:12px;color:var(--muted)}
.slot .v{font-weight:600;font-size:14px;line-height:1.15;margin-top:3px}
.slot.filled{border:1.5px solid transparent;background:var(--surface)}
.slot.filled .k{color:var(--lamp)}
.slot.target{border:2px solid var(--lamp);background:var(--lampsoft)}
.reel{position:relative;background:var(--board);color:var(--ink);border-radius:12px;padding:18px 20px 16px 26px;overflow:hidden;margin-bottom:10px}
.reel::before,.result-hero::before,.champion::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1.4px);background-size:6px 6px;pointer-events:none}
.stripe{position:absolute;left:0;top:0;bottom:0;width:8px;box-shadow:inset -1px 0 0 rgba(255,255,255,.12)}
.reel .pickno{font-size:13px;color:var(--muted);display:flex;justify-content:space-between}
.reel .team{font-family:var(--display);font-weight:900;font-size:clamp(46px,11vw,76px);line-height:.95;color:var(--lamp);text-shadow:0 0 18px rgba(245,179,36,.35);margin:6px 0 2px}
.reel .years{font-family:var(--display);font-weight:700;font-size:28px}
.reel .city{font-size:14px;color:var(--muted);margin-left:10px}
.reel.spin .team,.reel.spin .years{opacity:.75;filter:blur(.4px)}
.rerolls{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap}
.btn{border:1px solid #4A515F;background:linear-gradient(180deg,#333845,#242832);color:var(--ink);border-radius:9px;padding:9px 14px;font-weight:600;font-size:14px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -2px 0 rgba(0,0,0,.45),0 2px 4px rgba(0,0,0,.4);transition:transform .06s,box-shadow .06s,filter .12s}
.btn:hover:not(:disabled){filter:brightness(1.14)}
.btn:active:not(:disabled){transform:translateY(2px);box-shadow:inset 0 2px 5px rgba(0,0,0,.55),0 0 0 rgba(0,0,0,0)}
.btn:disabled{opacity:.42;cursor:default;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.btn.solid{border-color:#C98A0E;color:#241704}
.btn.sm{padding:5px 9px;font-size:13px}
.sec{margin:0 0 20px}
.sec .hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px;flex-wrap:wrap}
.sec h3{font-family:var(--display);font-weight:800;font-size:22px;margin:0;color:var(--ink)}
.sec .nt{font-size:13px;color:var(--muted)}
.sec.done h3{color:var(--muted)}
.card{background:var(--surface);border:1.5px solid transparent;border-radius:10px;padding:10px 12px;margin-bottom:6px}
.card:hover:not(.off){background:var(--surface2)}
.hit{all:unset;display:block;width:100%;cursor:pointer;color:var(--ink)}
.hit:disabled{cursor:default}
.ps .hit:focus-visible{outline:3px solid var(--lamp);outline-offset:4px;border-radius:4px}
.card.sel{border-color:var(--lamp);background:var(--surface2)}
.card.off{opacity:.4}
.card .row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.card .nm{font-weight:700;font-size:16px}
.card .meta{font-size:13px;color:var(--muted);margin-top:2px}
.cells{display:flex;flex-wrap:wrap;gap:6px 0}
.cell{width:62px}
.cell .n{font-weight:700;font-size:16px;line-height:1.1}
.cell .l{font-size:11px;color:var(--muted)}
.drafts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.note{font-size:13px;color:var(--muted);margin-top:8px}
.result-hero{background:var(--board);border-radius:12px;padding:22px 22px 18px;margin-bottom:18px;position:relative;overflow:hidden}
.rec{font-family:var(--display);font-weight:900;font-size:clamp(84px,22vw,140px);line-height:.85;color:var(--lamp);text-shadow:0 0 24px rgba(245,179,36,.35)}
.outcome{font-size:18px;font-weight:600;margin-top:10px}
.rating{font-size:14px;color:var(--muted);margin-top:4px}
.log{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;margin:8px 0 22px}
.g{border-radius:8px;padding:6px 8px;font-size:12px;background:var(--surface);border:1.5px solid transparent;animation:pop .25s ease-out both}
.g .w{font-weight:700;font-size:15px}
.g.win .w{color:var(--win)} .g.loss .w{color:var(--loss)}
.g.po{border-color:var(--line2)}
.g .o{color:var(--muted)}
@keyframes pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.reveal{border-top:1px solid var(--line)}
.rv{display:grid;grid-template-columns:44px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
.rv .s{font-weight:700;font-size:13px;color:var(--lamp)}
.rv .p{font-weight:700}
.rv .t{font-size:13px;color:var(--muted)}
.rv .pts{text-align:right;font-weight:700}
.rv .pts small{display:block;font-weight:400;font-size:11px;color:var(--muted)}
.gr{font-family:var(--display);font-weight:800;font-size:24px;min-width:38px;text-align:right}
h2.h{font-family:var(--display);font-weight:800;font-size:24px;color:var(--ink);margin:0 0 4px}
.nav{display:flex;gap:4px;border-bottom:1.5px solid var(--line);margin-bottom:16px}
.tab{border-radius:8px 8px 0 0}
.tab.on{background:linear-gradient(180deg,rgba(247,179,43,.12),transparent)}
.tab{background:none;border:none;border-bottom:3px solid transparent;margin-bottom:-1.5px;padding:8px 12px;font-weight:600;font-size:15px;color:var(--muted)}
.tab.on{color:var(--ink);border-bottom-color:var(--lamp)}
.tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--lamp);margin-left:6px;vertical-align:middle}
.panel{background:var(--surface);border-radius:10px;padding:14px;margin-bottom:16px}
.panel p{margin:0 0 10px;font-size:14px;color:var(--muted);max-width:60ch}
.panel h3{font-family:var(--display);font-weight:800;font-size:22px;color:var(--ink);margin:0 0 4px}
.inp{font:inherit;font-size:15px;padding:8px 10px;border:1.5px solid var(--line2);border-radius:8px;min-width:0;flex:1;max-width:260px;color:var(--ink);background:var(--board)}
.inp:focus{outline:none;border-color:var(--lamp)}
.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:18px}
.tile{background:var(--surface);border-radius:10px;padding:12px}
.tile .n{font-family:var(--display);font-weight:800;font-size:32px;line-height:1}
.tile .l{font-size:13px;color:var(--muted);margin-top:4px}
.who{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.who .nm{font-family:var(--display);font-weight:900;font-size:36px;line-height:1}
.linkbtn{background:none;border:none;padding:0;color:var(--lamp);font-weight:600;font-size:14px;text-decoration:underline;text-underline-offset:3px}
.lb{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px}
.lb th{text-align:left;font-weight:600;font-size:12px;color:var(--muted);padding:6px 8px;border-bottom:1.5px solid var(--line)}
.lb td{padding:9px 8px;border-bottom:1px solid var(--line)}
.lb td.r,.lb th.r{text-align:right}
.lb tr.me td{background:var(--lampsoft)}
.lb .rk{font-family:var(--display);font-weight:800;font-size:18px;width:32px}
.champion{background:var(--board);border-radius:12px;padding:18px 20px 18px 26px;margin-bottom:18px;position:relative;overflow:hidden}
.champion .sc{font-family:var(--display);font-weight:900;font-size:64px;line-height:.9;color:var(--lamp);text-shadow:0 0 18px rgba(245,179,36,.35)}
.champion .by{font-size:16px;font-weight:600;margin-top:6px}
.champion .ln{font-size:13px;color:var(--muted);margin-top:8px;line-height:1.5}
.champion .pickno{font-size:13px;color:var(--muted)}
.badge{display:inline-block;background:var(--lamp);color:#15201A;font-weight:700;font-size:13px;border-radius:4px;padding:3px 8px;margin-top:10px;margin-right:6px}
.recent{border-top:1px solid var(--line);margin-bottom:18px}
.rr{display:grid;grid-template-columns:70px 64px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:center}
.rr .rec2{font-family:var(--display);font-weight:800;font-size:20px}
.muted{color:var(--muted)}
.seg{display:inline-flex;border:1.5px solid var(--line2);border-radius:8px;overflow:hidden;margin:4px 0 12px}
.seg button{background:none;border:none;padding:7px 14px;font-weight:600;font-size:14px;color:var(--muted)}
.seg button.on{background:var(--lamp);color:#15201A}
.fields{display:grid;gap:10px;max-width:320px}
.fields label{display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
.fields .inp{max-width:none}
.err{color:var(--loss)!important;font-weight:600;margin:10px 0 0!important}
.fine{font-size:12.5px!important;margin:10px 0 0!important}
.guest{font-size:14px;color:var(--muted);margin:0 0 12px}
.sticky{position:fixed;top:0;left:0;right:0;z-index:30;background:rgba(14,23,19,.95);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line);transform:translateY(-110%);transition:transform .18s ease-out}
.sticky.show{transform:none}
.sticky .in{position:relative;max-width:880px;margin:0 auto;padding:8px 16px 8px 24px;display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.sticky .stripe{width:6px}
.sticky .tm{font-family:var(--display);font-weight:900;font-size:26px;line-height:1;color:var(--lamp)}
.sticky .yr{font-family:var(--display);font-weight:700;font-size:19px;line-height:1}
.sticky .pk{font-size:12px;color:var(--muted)}
.chips{display:flex;gap:4px}
.chip{font-size:11px;font-weight:700;padding:3px 6px;border-radius:4px;border:1px dashed var(--line2);color:var(--muted)}
.chip.on{border:1px solid transparent;background:var(--surface2);color:var(--lamp)}
.sticky .sp{margin-left:auto;display:flex;gap:6px}
.brk{display:none}
.pg{background:var(--board);border-radius:12px;padding:14px 16px 16px;margin-bottom:18px;position:relative;overflow:hidden}
.pg-top{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);font-weight:600}
.sb{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:10px;margin:6px 0 12px}
.sb .tm{font-weight:700;font-size:14px;color:var(--muted)}
.sb .r{text-align:right}
.sb .pts{font-family:var(--display);font-weight:900;font-size:clamp(44px,12vw,64px);line-height:1;color:var(--ink);transition:color .3s}
.sb .lead .pts{color:var(--lamp)}
.sb .lead .tm{color:var(--ink)}
.clock{font-family:var(--display);font-weight:800;font-size:22px;text-align:center;min-width:84px;padding-bottom:6px}
.clock small{display:block;font-family:'Barlow',sans-serif;font-size:14px;font-weight:600;color:var(--muted)}
.field{position:relative;display:grid;grid-template-columns:9% 1fr 9%;height:60px;border-radius:8px;overflow:hidden}
.ez{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:rgba(255,255,255,.55);background:#1A4A2E;writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.5px;overflow:hidden;white-space:nowrap}
.ez.r{background:#3d3413;color:rgba(245,179,36,.8);transform:none}
.yards{position:relative;background:#1f5233;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 1px,transparent 1px 10%),repeating-linear-gradient(90deg,transparent 0 10%,rgba(0,0,0,.08) 10% 20%)}
.fifty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--display);font-weight:800;font-size:18px;color:rgba(255,255,255,.25)}
.ball{position:absolute;top:50%;width:14px;height:9px;border-radius:50%;background:#e9e2d0;transform:translate(-50%,-50%);transition:left .32s cubic-bezier(.2,.7,.3,1);box-shadow:0 0 0 2px rgba(0,0,0,.25);animation:fadein .25s ease-out}
.ball.air{transition:left .5s cubic-bezier(.3,.1,.3,1)}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.trail{position:absolute;top:50%;height:4px;transform:translateY(-50%);background:rgba(233,226,208,.35);border-radius:2px;transition:left .32s cubic-bezier(.2,.7,.3,1),width .32s cubic-bezier(.2,.7,.3,1)}
.trail.mine{background:rgba(245,179,36,.45)}
.ball.mine{background:var(--lamp);box-shadow:0 0 10px rgba(245,179,36,.7)}
.flash{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,23,19,.78);font-family:var(--display);font-weight:900;font-size:clamp(22px,6vw,34px);color:var(--ink);animation:pop .2s ease-out both;text-align:center;padding:0 10px}
.flash.mine{color:var(--lamp);text-shadow:0 0 16px rgba(245,179,36,.5)}
.pbp{margin-top:8px;min-height:2.6em}
.pbp .now{font-size:14px;font-weight:600;color:var(--ink)}
.spot{margin-top:2px;font-size:13px;color:var(--muted)}
.spot.rz{color:var(--lamp)}
.plog{margin-top:8px;font-size:13px;color:var(--muted);min-height:3.9em;line-height:1.3}
.plog div:first-child{color:var(--ink)}
.pfinal{margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fin{font-family:var(--display);font-weight:900;font-size:30px}
.fin.w{color:var(--win)} .fin.l{color:var(--loss)}
.pre{background:var(--board);border-radius:12px;padding:18px;margin-bottom:18px}
.pre h3{font-family:var(--display);font-weight:900;font-size:34px;margin:0;color:var(--lamp)}
.pre p{margin:4px 0 14px;color:var(--muted);font-size:15px}
.place{margin-top:10px;font-size:15px;color:var(--ink);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.place b{font-family:var(--display);font-weight:900;font-size:26px;color:var(--lamp)}
.place .pct{font-size:13px;font-weight:700;color:#15201A;background:var(--lamp);border-radius:4px;padding:2px 7px}
.recap{border-top:1px solid var(--line);margin-bottom:8px}
.rc{display:grid;grid-template-columns:28px 1fr 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:start}
.rc .n{font-family:var(--display);font-weight:800;font-size:20px;color:var(--muted)}
.rc .bd{font-size:12px;color:var(--muted);margin-bottom:2px}
.rc .tk{font-weight:700}
.rc .g2{font-family:var(--display);font-weight:800;margin-left:6px;color:var(--lamp)}
.rc .alt{color:var(--muted)}
.rc .alt b{color:var(--ink);font-weight:600}
.rc .ok{color:var(--win);font-weight:600}
.recap-sum{font-size:15px;margin:2px 0 10px}
.recap-sum b{font-family:var(--display);font-weight:900;font-size:22px;color:var(--lamp)}
.sharebox{width:100%;min-height:150px;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--board);color:var(--ink);border:1.5px solid var(--line2);border-radius:8px;padding:10px;margin-top:10px}
.notice{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px}
.modal-bg{position:fixed;inset:0;z-index:50;background:rgba(5,10,8,.72);display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto}
.modal{background:var(--surface);border-radius:14px;max-width:520px;width:100%;padding:20px 20px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h2{font-family:var(--display);font-weight:900;font-size:34px;margin:0 0 10px;color:var(--lamp)}
.modal ol{margin:0 0 12px;padding-left:22px}
.modal li{margin-bottom:9px;font-size:15px;line-height:1.4}
.modal li b{color:var(--ink)}
.modal .small{font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.45}
.hdr-links{display:flex;gap:14px;justify-content:flex-end;margin-top:6px}
.btn.reset{margin-left:auto;color:var(--muted);border-color:#3A404C;background:linear-gradient(180deg,#2B2F3A,#1F232B)}
.btn.reset:hover:not(:disabled){color:var(--ink)}
.btn.reset.armed{color:#FFD9D2;border-color:#B4483A;background:linear-gradient(180deg,#B4483A,#8E3225)}

/* ===== Visual layer: stadium night, team colors, LED scoreboard ===== */
.ps{--bg:#15171C;--surface:#1E2128;--surface2:#272B34;--line:#31353F;--line2:#434955;--ink:#ECEEF2;--muted:#99A0AE;--lamp:#F7B32B;--board:#0D0F13;
  --qb:#F2557A;--rb:#2FD3B5;--wr:#5AA9FF;--te:#F5A04A;--flex:#B18CFF;--ga:#4ADE80;--gb:#2FD3B5;--gc:#F7B32B;--gd:#F07B6B;
  --bevel:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -1px 0 rgba(0,0,0,.5);
  background:
    radial-gradient(ellipse 90% 40% at 50% -10%, rgba(255,235,190,.09), transparent 70%),
    linear-gradient(180deg, #1A1D23 0%, #121419 100%);}
.pos-QB{--pc:var(--qb)} .pos-RB{--pc:var(--rb)} .pos-WR{--pc:var(--wr)} .pos-TE{--pc:var(--te)} .pos-FLEX{--pc:var(--flex)}
.ga{color:var(--ga)!important} .gb{color:var(--gb)!important} .gc{color:var(--gc)!important} .gd{color:var(--gd)!important}

/* header */
.brand{display:flex;align-items:center;gap:12px}
.brand svg{flex:none;filter:drop-shadow(0 3px 10px rgba(247,179,43,.35))}
.title{letter-spacing:0}

/* LED dot-matrix numerals: the wrapper glows, the inner text is cut into bulbs */
.led-wrap{filter:drop-shadow(0 0 6px rgba(247,179,43,.55)) drop-shadow(0 0 18px rgba(247,179,43,.25))}
.led{display:inline-block;color:var(--lamp);-webkit-mask-image:radial-gradient(circle,#000 56%,transparent 62%);mask-image:radial-gradient(circle,#000 56%,transparent 62%);
  -webkit-mask-size:var(--dot,6px) var(--dot,6px);mask-size:var(--dot,6px) var(--dot,6px)}
.rec{text-shadow:none;--dot:7px}
.sb .pts{--dot:4px}
.sb .pts .led{color:#F4EFE3}
.sb .lead .pts .led{color:var(--lamp)}
.sb .pts.led-wrap{filter:drop-shadow(0 0 5px rgba(247,179,43,.35))}
.reel .years{--dot:3.2px;font-size:32px}
.champion .sc{text-shadow:none;--dot:5px}

/* the spin: a broadcast-style team banner in that team's colors */
.reel{background:linear-gradient(102deg,var(--tc1) 0%,color-mix(in srgb,var(--tc1) 62%,#12151B) 46%,color-mix(in srgb,var(--tc1) 18%,#12151B) 82%);padding-left:22px;border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 12px 30px rgba(0,0,0,.35)}
.reel>*{position:relative;z-index:1}
.reel::after{content:'';position:absolute;z-index:0;top:-10%;bottom:-10%;right:7%;width:18px;background:var(--tc2);transform:skewX(-18deg);opacity:.7;box-shadow:26px 0 0 color-mix(in srgb,var(--tc2) 35%,transparent)}
.reel .stripe{display:none}
.reel .pickno{color:rgba(255,255,255,.72)}
.reel .team{color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35),0 6px 24px rgba(0,0,0,.4);transform:skewX(-7deg);transform-origin:left bottom;letter-spacing:.5px}
.reel .city{color:rgba(255,255,255,.75)}
.reel.spin .team{opacity:.8;filter:blur(.6px)}
.sticky{background:linear-gradient(102deg,color-mix(in srgb,var(--tc1) 78%,#12151B) 0%,rgba(18,21,27,.95) 58%)}
.sticky .tm{color:#fff;transform:skewX(-7deg)}
.sticky .stripe{background:var(--tc2)!important}

/* roster: position-colored spots */
.slot{border-radius:10px}
.slot .k{color:var(--pc)}
.slot.filled{background:linear-gradient(180deg,var(--surface2),var(--surface));border:1px solid #363B46;box-shadow:inset 0 3px 0 var(--pc),var(--bevel),0 2px 4px rgba(0,0,0,.35)}
.slot.filled .k{color:var(--pc)}
.slot .sub{font-size:11.5px;color:var(--muted);margin-top:2px;font-weight:500}
.chip.on{color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent)}

/* player cards: position edge + pill, trading-card feel */
.sec h3{display:flex;align-items:center;gap:9px}
.sec h3::before{content:'';width:10px;height:10px;border-radius:3px;background:var(--pc);box-shadow:0 0 10px color-mix(in srgb,var(--pc) 60%,transparent)}
.card{border-radius:9px;background:linear-gradient(90deg,color-mix(in srgb,var(--pc) 10%,var(--surface)) 0%,var(--surface) 38%);box-shadow:inset 4px 0 0 var(--pc),var(--bevel),0 1px 3px rgba(0,0,0,.35)}
.card:hover:not(.off){background:linear-gradient(90deg,color-mix(in srgb,var(--pc) 14%,var(--surface2)) 0%,var(--surface2) 45%)}
.card.sel{border-color:var(--lamp);box-shadow:inset 4px 0 0 var(--pc),0 0 0 1.5px var(--lamp),var(--bevel),0 8px 24px rgba(0,0,0,.45)}
.nm-row{display:flex;align-items:center;gap:8px}
.pp{font-size:11px;font-weight:700;color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent);border-radius:4px;padding:1px 6px}
.tdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tc1);box-shadow:0 0 0 1.5px var(--tc2);margin-right:6px;vertical-align:middle}
.cell:first-child .n{color:var(--pc)}

/* results */
.result-hero{background:radial-gradient(ellipse 70% 90% at 15% 0%,rgba(247,179,43,.10),transparent 60%),var(--board);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(255,255,255,.05),0 14px 34px rgba(0,0,0,.5)}
.g{border-left:3px solid transparent}
.g.win{background:linear-gradient(90deg,rgba(74,222,128,.13),var(--surface) 70%);border-left-color:var(--ga)}
.g.loss{background:linear-gradient(90deg,rgba(240,123,107,.14),var(--surface) 70%);border-left-color:var(--gd)}
.g.win .w{color:var(--ga)} .g.loss .w{color:var(--gd)}
.g.po{box-shadow:0 0 0 1px var(--lamp) inset}
.rv .s{color:var(--pc)}
.pre{background:radial-gradient(ellipse 60% 100% at 0% 0%,rgba(247,179,43,.16),transparent 65%),var(--board);border:1px solid rgba(247,179,43,.35)}
.pg{box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 30px rgba(0,0,0,.35)}
.btn.solid{background:linear-gradient(180deg,#FFD166 0%,#F7B32B 48%,#E09A12 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -2px 0 rgba(140,90,0,.55),0 3px 10px rgba(247,179,43,.28)}
.btn.solid:active:not(:disabled){box-shadow:inset 0 2px 6px rgba(120,76,0,.5)}
.tile{background:linear-gradient(160deg,var(--surface2),var(--surface));box-shadow:var(--bevel)}
.panel{box-shadow:var(--bevel),0 2px 6px rgba(0,0,0,.3)}
.g{box-shadow:var(--bevel)}
.seg{box-shadow:var(--bevel)}
.seg button.on{box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -2px 0 rgba(140,90,0,.5);background:linear-gradient(180deg,#FFD166,#E09A12)}
.inp{box-shadow:inset 0 2px 4px rgba(0,0,0,.45)}
.tab.on{border-bottom-color:var(--lamp)}

/* ===== modes, daily, celebration ===== */
.modebar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.mb{border:1px solid #3A404C;background:linear-gradient(180deg,#2B2F3A,#1F232B);color:var(--muted);border-radius:8px;padding:7px 13px;font-weight:600;font-size:14px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),inset 0 -2px 0 rgba(0,0,0,.4)}
.mb.on{color:#241704;border-color:#C98A0E;background:linear-gradient(180deg,#FFD166,#E09A12);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -2px 0 rgba(140,90,0,.5)}
.mb:active{transform:translateY(1px)}
.seedline{font-size:13px;color:var(--muted);margin-left:auto;display:flex;align-items:center;gap:8px}
.seedline code{font-family:ui-monospace,Menlo,monospace;font-size:14px;letter-spacing:1px;color:var(--lamp);background:var(--board);border-radius:5px;padding:3px 8px;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.streak{display:inline-flex;align-items:baseline;gap:6px;font-size:13px;color:var(--muted)}
.streak b{font-family:var(--display);font-weight:900;font-size:22px;color:var(--lamp)}
.dayhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.locked{background:linear-gradient(160deg,var(--surface2),var(--surface));border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:var(--bevel)}
.locked h3{font-family:var(--display);font-weight:800;font-size:24px;margin:0 0 6px}
.cel{position:relative;overflow:hidden;border-radius:12px;padding:16px 18px;margin-bottom:16px;text-align:center;
  background:radial-gradient(ellipse 80% 120% at 50% 0%,rgba(247,179,43,.35),transparent 65%),linear-gradient(180deg,#2A2110,#14161B);
  box-shadow:inset 0 0 0 1.5px rgba(247,179,43,.55),0 10px 34px rgba(0,0,0,.5)}
.cel .big{font-family:var(--display);font-weight:900;line-height:.92;font-size:clamp(34px,10vw,56px);color:var(--lamp);text-shadow:0 0 22px rgba(247,179,43,.55)}
.cel .sml{font-size:15px;color:var(--ink);margin-top:6px}
.cel.perfect .big{background:linear-gradient(100deg,#FFE9A8,#F7B32B 35%,#FFF3CF 50%,#F7B32B 65%,#E09A12);-webkit-background-clip:text;background-clip:text;color:transparent;
  background-size:250% 100%;animation:sheen 2.6s linear infinite;text-shadow:none}
@keyframes sheen{from{background-position:160% 0}to{background-position:-60% 0}}
.confetti{position:absolute;inset:0;pointer-events:none}
.confetti i{position:absolute;top:-12%;width:7px;height:12px;border-radius:1px;opacity:0;animation:fall 2.6s ease-in forwards}
@keyframes fall{0%{opacity:0;transform:translateY(0) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(320px) rotate(520deg)}}
@media (prefers-reduced-motion:reduce){.confetti{display:none}.cel.perfect .big{animation:none;background:none;color:var(--lamp)}}

/* landing page */
.hero{margin:6px 0 22px}
.hero .brand{margin-bottom:8px}
.hero .sub{max-width:60ch;font-size:16px;line-height:1.5}
.modes{display:grid;gap:10px;margin-bottom:18px}
.mode{display:block;width:100%;text-align:left;border:1px solid #363B46;border-radius:12px;padding:16px 18px;color:var(--ink);
  background:linear-gradient(160deg,var(--surface2),var(--surface));box-shadow:var(--bevel),0 3px 10px rgba(0,0,0,.35);transition:transform .08s,filter .12s}
.mode:hover:not(.static){filter:brightness(1.12)}
.mode:active:not(.static){transform:translateY(2px)}
.mode.static{cursor:default}
.mode.daily{background:radial-gradient(ellipse 70% 130% at 0% 0%,rgba(247,179,43,.22),transparent 60%),linear-gradient(160deg,var(--surface2),var(--surface));border-color:rgba(247,179,43,.5)}
.mode .mt{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.mode .mn{font-family:var(--display);font-weight:800;font-size:27px;line-height:1}
.mode p{margin:6px 0 10px;color:var(--muted);font-size:14.5px;max-width:58ch}
.mode .icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  font-size:21px;line-height:1;flex:0 0 auto;background:var(--lampsoft);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.mode .go{font-weight:800;font-size:13.5px;color:#241704;background:var(--lamp);border-radius:999px;padding:7px 14px 7px 16px;
  display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 10px rgba(245,179,36,.25);transition:transform .08s,filter .12s}
.mode .go::after{content:'\\2192';font-weight:900}
.mode:hover:not(.static) .go{filter:brightness(1.08)}
.mode:active:not(.static) .go{transform:translateY(1px)}
.mode.m-unlimited .icon{background:rgba(90,169,255,.18);color:#5AA9FF}
.mode.m-unlimited .go{background:#5AA9FF;color:#0A1526;box-shadow:0 2px 10px rgba(90,169,255,.25)}
.mode.m-genius .icon{background:rgba(177,140,255,.18);color:#B18CFF}
.mode.m-genius .go{background:#B18CFF;color:#1A1030;box-shadow:0 2px 10px rgba(177,140,255,.25)}
.mode.m-gm .icon{background:rgba(74,222,128,.18);color:#4ADE80}
.mode.m-gm .go{background:#4ADE80;color:#08210F;box-shadow:0 2px 10px rgba(74,222,128,.25)}
.mode.m-sou .icon{background:rgba(242,85,122,.18);color:#F2557A}
.mode.m-sou .go{background:#F2557A;color:#2B0710;box-shadow:0 2px 10px rgba(242,85,122,.25)}
.mode.m-bap .icon{background:rgba(47,211,198,.18);color:#2FD3C6}
.mode.m-bap .go{background:#2FD3C6;color:#04211E;box-shadow:0 2px 10px rgba(47,211,198,.25)}
.mode.static .icon{background:rgba(147,168,155,.14);color:var(--muted)}
.mode .pill{font-size:12px;font-weight:700;color:#241704;background:var(--lamp);border-radius:20px;padding:2px 9px}
.hometiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px}
.hometiles .n{font-size:26px}
.whoami{font-weight:600;font-size:14px;color:var(--ink)}
.nav .hdr-links{margin-left:auto;margin-top:0;align-items:center;padding-bottom:6px}
.nav{align-items:center}
@media (max-width:640px){.modes{gap:8px}.mode{padding:14px}.mode .mn{font-size:24px}.mode .icon{width:36px;height:36px;font-size:18px;border-radius:10px}}
@media (max-width:640px){.btn.reset{margin-left:0}.rc{grid-template-columns:24px 1fr}.rc .alt{grid-column:2}.cells{display:grid;grid-template-columns:repeat(4,1fr);width:100%;gap:8px 6px}.cell{width:auto}.sticky .in{padding:6px 12px 7px 18px;gap:4px 8px}.sticky .tm{font-size:24px}.chip{padding:2px 4px;font-size:10.5px}.sticky .btn.sm{padding:4px 8px;font-size:11.5px}.sticky .pk{display:none}.roster{grid-template-columns:repeat(3,1fr)}.title{font-size:36px}.tiles{grid-template-columns:repeat(2,1fr)}.lb .hide{display:none}.rr{grid-template-columns:56px 56px 1fr}.rr .sc2{display:none}.sticky .sp{margin-left:auto}.brk{display:block;flex-basis:100%;height:0}}
@media (prefers-reduced-motion:reduce){.g,.flash,.ball{animation:none}.ball,.trail{transition:none}.sticky{transition:none}}
`;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Storage ----------
// Accounts and sessions are now handled by Supabase Auth (storage.js's authSignUp/authSignIn/
// authGetSession/authOnChange) - no client-side password hashing or session token needed.
// Personal (device):  ps-profile -> pre-login guest stats, folded into the real account on signup
const OLD_PROFILE = "ps-profile";

function blankStats(username) {
  return { username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0,
    bestScore: null, bestRun: null, bestRecord: null, recent: [], created: Date.now() };
}
const betterRecord = (a, b) => !b || a.w > b.w || (a.w === b.w && a.l < b.l);
// A reset draft is a DNF: it counts as a draft but has no record or score
function applyDnf(prev, picks) {
  return { ...prev, dnf: (prev.dnf || 0) + 1, recent: [{ dnf: true, picks, date: Date.now() }, ...(prev.recent || [])].slice(0, 10), updated: Date.now() };
}
const draftsOf = (s) => (s.runs || 0) + (s.dnf || 0);

function applyRun(prev, run) {
  const s = {
    ...prev,
    runs: prev.runs + 1, wins: prev.wins + run.w, losses: prev.losses + run.l,
    champs: prev.champs + (run.champ ? 1 : 0), perfect: prev.perfect + (run.perfect ? 1 : 0),
    playoffs: prev.playoffs + (run.playoffs ? 1 : 0),
    recent: [run, ...(prev.recent || [])].slice(0, 10), updated: Date.now(),
  };
  if (prev.bestScore == null || run.score > prev.bestScore) { s.bestScore = run.score; s.bestRun = run; }
  if (betterRecord(run, prev.bestRecord)) s.bestRecord = { w: run.w, l: run.l };
  return s;
}
const topPct = (rank, total) => {
  const p = (100 * rank) / total;
  return p < 1 ? `Top ${p.toFixed(1)}%` : `Top ${Math.max(1, Math.round(p))}%`;
};
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

const OUTCOME_BUTTONS = [
  ["perfect", "Force 20–0 (perfect)"],
  ["champ", "Force championship win"],
  ["lostWildCard", "Force loss: Wild Card"],
  ["lostDivisional", "Force loss: Divisional"],
  ["lostConference", "Force loss: Conference"],
  ["lostChampionship", "Force loss: Championship"],
  ["missedPlayoffs", "Force missed playoffs"],
];

// Admin-only testing panel: jump straight to any board, force a specific player into a slot,
// or force a scripted season ending, all without touching real stats or storage.
function AdminPanel({ openSlots, onForceBoard, onForcePlayer, onForceOutcome }) {
  const [team, setTeam] = useState(TEAM_CODES[0]);
  const [w, setW] = useState(0);
  const [query, setQuery] = useState("");
  const matches = adminSearchPlayers(query);
  return (
    <div className="panel">
      <h3>Admin tools</h3>
      <div className="frow" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select className="inp" value={team} onChange={(e) => setTeam(e.target.value)}>
          {TEAM_CODES.map((t) => <option key={t} value={t}>{TEAMS[t][0]}</option>)}
        </select>
        <select className="inp" value={w} onChange={(e) => setW(Number(e.target.value))}>
          {WINDOWS.map((win, i) => <option key={i} value={i}>{win[0]}–{win[1]}</option>)}
        </select>
        <button className="btn sm" onClick={() => onForceBoard(team, w)}>Jump to board</button>
      </div>
      <div className="frow" style={{ marginTop: 8 }}>
        <input className="inp" placeholder="Force a player by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {matches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {matches.map((p) => (
            <div key={`${p.id}-${p.season}-${p.team}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 0" }}>
              <span style={{ fontSize: 13 }}>{p.name} - {p.season} {TEAMS[p.team][0]} ({p.pos})</span>
              {openSlots.filter((s) => fits(p.pos, s)).map((s) => (
                <button key={s} className="btn sm" onClick={() => onForcePlayer(p, s)}>{SLOT_LABEL[s]}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="frow" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        {OUTCOME_BUTTONS.map(([key, label]) => (
          <button key={key} className="btn sm" onClick={() => onForceOutcome(key)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function RosterRows({ roster }) {
  return (
    <div className="reveal">
      {roster.map((p) => (
        <div className={`rv pos-${p.slot.startsWith("FLEX") ? "FLEX" : p.slot}`} key={p.slot}>
          <div className="s">{SLOT_LABEL[p.slot]}</div>
          <div><div className="p">{p.name}</div><div className="t">{p.season} {teamLabel(p.team, p.season)}</div></div>
          <div className="pts">{p.ppr.toFixed(1)}<small>PPR pts</small></div>
          <div className={`gr ${gradeTier(p.rating)}`}>{grade(p.rating)}</div>
        </div>
      ))}
    </div>
  );
}

function AuthPanel({ onAuthed, title, blurb }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [u, setU] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    const emailTrim = email.trim();
    const username = u.trim();
    if (!emailTrim || !emailTrim.includes("@")) return setErr("Enter a valid email address.");
    if (mode === "signup" && !USER_RE.test(username)) return setErr("Usernames are 3 to 16 characters: letters, numbers, and underscores.");
    if (pw.length < 6) return setErr("Passwords need at least 6 characters.");
    if (mode === "signup" && pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await authSignUp(emailTrim, pw, username);
        if (error) { setBusy(false); return setErr(mapAuthError(error)); }
        await onAuthed(data.user.id, username, true);
      } else {
        const { data, error } = await authSignIn(emailTrim, pw);
        if (error) { setBusy(false); return setErr("Incorrect email or password."); }
        const prof = await fetchProfile(data.user.id);
        await onAuthed(data.user.id, prof?.username || "", false);
      }
    } catch (e) {
      setErr("Something went wrong. Try again.");
    }
    setBusy(false);
  }

  const onKey = (e) => e.key === "Enter" && !busy && submit();
  return (
    <div className="panel">
      {title && <h3>{title}</h3>}
      {blurb && <p>{blurb}</p>}
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>Log in</button>
        <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Create account</button>
      </div>
      <div className="fields">
        <label>Email<input className="inp" type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} /></label>
        {mode === "signup" && <label>Username<input className="inp" value={u} maxLength={16} autoComplete="username" onChange={(e) => setU(e.target.value)} onKeyDown={onKey} /></label>}
        <label>Password<input className="inp" type="password" value={pw} autoComplete={mode === "signup" ? "new-password" : "current-password"} onChange={(e) => setPw(e.target.value)} onKeyDown={onKey} /></label>
        {mode === "signup" && <label>Confirm password<input className="inp" type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} onKeyDown={onKey} /></label>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="frow" style={{ marginTop: 10 }}>
        <button className="btn solid" disabled={busy} onClick={submit}>{busy ? "Checking…" : mode === "login" ? "Log in" : "Create account"}</button>
      </div>
      {mode === "signup" && <p className="fine">Your username, best score, and best lineup appear on the leaderboard. Your email is never shown publicly.</p>}
    </div>
  );
}

const DRAFT_KEY = "ps-draft";
const DAILY_KEY = (d) => `ps-daily:${d}`;
const DAILY_PROGRESS = (d) => `ps-daily-wip:${d}`;
const FREE_PROGRESS = "ps-free-wip";
const HOWTO_KEY = "ps-howto-seen";
const findPlayer = (key, id, season) => (BOARDS[key] || []).find((p) => p.id === id && p.season === season);
const shortYr = (y) => `'${String(y).slice(2)}`;

function bestAvailable(key, draftedIds, openSlots) {
  const c = (BOARDS[key] || []).filter((p) => !draftedIds.includes(p.id) && openSlots.some((s) => fits(p.pos, s)));
  return c.reduce((a, p) => (!a || p.rating > a.rating ? p : a), null);
}

function permute(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// Retrospective best possible roster: given the 6 boards actually seen this draft (fixed,
// not choosable), find the board-to-slot assignment that maximizes team score. Unlike
// bestAvailable (which is greedy and pick-order-dependent - "best player on this board given
// whatever slots happened to still be open at that exact moment"), this considers all 720
// board/slot pairings so a QB taken early only because it was the lone option doesn't hide a
// much better QB seen later on a board whose player ended up elsewhere.
function bestOrderFor(history) {
  const boardKeys = history.map((h) => h.key);
  let best = null;
  for (const order of permute(SLOTS)) {
    let total = 0, ok = true;
    const assignment = {};
    for (let i = 0; i < boardKeys.length; i++) {
      const slot = order[i], key = boardKeys[i];
      const top = (BOARDS[key] || []).filter((p) => fits(p.pos, slot))
        .reduce((a, p) => (!a || effectiveRating(slot, p) > effectiveRating(slot, a) ? p : a), null);
      if (!top) { ok = false; break; }
      total += effectiveRating(slot, top) * (slot === "QB" ? QB_WEIGHT : 1);
      assignment[slot] = { key, player: top };
    }
    if (ok && (!best || total > best.totalRating)) best = { slotAssignment: assignment, totalRating: total };
  }
  return best;
}

// streak = consecutive calendar days with a finished daily
function nextStreak(stats, date) {
  const prev = stats.dailyLast;
  if (prev === date) return stats.dailyStreak || 1;
  const y = new Date(date + "T00:00:00"); y.setDate(y.getDate() - 1);
  const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return prev === yk ? (stats.dailyStreak || 0) + 1 : 1;
}

function Confetti({ n = 26 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: `${(i * 97) % 100}%`, delay: `${(i % 9) * 0.12}s`,
    bg: ["#F7B32B", "#5AA9FF", "#4ADE80", "#F2557A", "#B18CFF"][i % 5],
    dur: `${2.2 + ((i * 7) % 9) / 10}s`,
  })), [n]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => <i key={i} style={{ left: b.left, background: b.bg, animationDelay: b.delay, animationDuration: b.dur }} />)}
    </div>
  );
}

function shareText(result, roster, place, mode) {
  const reg = result.games.filter((g) => !g.playoff).map((g) => (g.win ? "🟩" : "🟥")).join("");
  const po = result.games.filter((g) => g.playoff).map((g) => (g.win ? "🟩" : "🟥")).join("");
  const lines = [
    mode && mode.kind === "daily" ? `Perfect Season 🏈 Daily ${mode.date} · ${result.w}–${result.l}` : `Perfect Season 🏈 ${result.w}–${result.l}`,
    result.outcome,
    `Team score ${result.score.toFixed(1)}${place ? ` · #${place.rank.toLocaleString()} of ${place.total.toLocaleString()}` : ""}`,
    reg,
  ];
  if (po) lines.push(`Playoffs ${po}`);
  lines.push(SLOTS.map((s) => `${s.startsWith("FLEX") ? "FX" : s} ${lastName(roster[s].name)} ${shortYr(roster[s].season)}`).join(", "));
  if (mode && mode.kind !== "daily") lines.push(`Draft the same boards: code ${mode.code}`);
  return lines.join("\n");
}

function HowTo({ onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    btn.current && btn.current.focus();
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="howto-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="howto-title">How to play</h2>
        <ol>
          <li>Each round spins a <b>team and a five-year era</b>, like "Rams, 1999–2005." Draft one player from that board.</li>
          <li>Fill six spots: <b>QB, RB, WR, TE, and two Flex</b>. A Flex can be any RB, WR, or TE.</li>
          <li>Every player shows <b>his best season</b> for that team in that era. The stats are real. The fantasy points are hidden.</li>
          <li>You get <b>one team re-spin and one era re-spin</b> per draft. Use them wisely.</li>
          <li>Play <b>unlimited</b> drafts any time, or take the <b>daily</b> — one draft a day, the same boards for everyone.</li>
          <li>Your six are graded, then your team plays <b>17 games against real NFL teams</b> and, if you're good enough, the playoffs. Win them all for a <b>perfect 20–0 season</b>.</li>
        </ol>
        <p className="small">Grades are based on PPR fantasy points compared to the top players at that position in the same era, with a bump for efficiency (QB rating, completion %, yards per carry). Flex is graded on raw production instead, with no positional comparison. Your QB counts a little more than the others.</p>
        <button ref={btn} className="btn solid" onClick={onClose}>Got it, let's draft</button>
      </div>
    </div>
  );
}

export default function PerfectSeason() {
  const [view, setView] = useState("home");
  const [roster, setRoster] = useState({});
  const [spin, setSpin] = useState(null);
  const [display, setDisplay] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [used, setUsed] = useState([]);
  const [rerolls, setRerolls] = useState({ team: 1, years: 1 });
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [shown, setShown] = useState(0);
  const [po, setPo] = useState({ idx: 0, stage: "pre" });
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null); // Supabase auth user id - the real key for profile reads/writes
  const [stats, setStats] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [lb, setLb] = useState({ loading: true, top: [], totals: { runs: 0, perfect: 0, players: 0 }, myRank: -1 });
  const timer = useRef(null);
  const recentSpins = useRef([]);
  const [history, setHistory] = useState([]); // one entry per pick, for the recap and for resuming
  const [draftReady, setDraftReady] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [share, setShare] = useState({ state: "idle", text: "" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [mode, setMode] = useState(null);           // { kind: "free"|"daily", code, date, seed }
  const [seq, setSeq] = useState([]);               // seeded board order for this draft
  const [seqIdx, setSeqIdx] = useState(0);
  const [dailyDone, setDailyDone] = useState(null); // today's finished daily, if any
  const [codeInput, setCodeInput] = useState("");
  const [dailyBoard, setDailyBoard] = useState({ loading: false, rows: [] });
  const [souRound, setSouRound] = useState(null); // { name, pos, teams, statLabel, trueValue, line, guess, correct }
  const [souScore, setSouScore] = useState({ right: 0, wrong: 0 });
  const [bap, setBap] = useState(null); // { pos, filled: {stat: value}, contributors: [player], remaining: [stat], roll: player }
  const [wip, setWip] = useState({});               // unfinished drafts, by mode
  // Counts in-flight clearDraft() calls per mode. clearDraft is fire-and-forget (overwrite,
  // then delete - see clearDraft below), so a refreshWip() read can land before it's done and
  // return the stale pre-clear snapshot; while a clear is pending for a mode, refreshWip()
  // leaves that mode's wip alone instead of trusting the read.
  const pendingClears = useRef({ free: 0, daily: 0 });
  function clearDraftTracked(kind, key) {
    pendingClears.current[kind]++;
    clearDraft(key).finally(() => { pendingClears.current[kind]--; });
  }
  const sentinel = useRef(null);
  const draftTop = useRef(null);
  const [stuck, setStuck] = useState(false);
  const [showDone, setShowDone] = useState({});

  const drafted = useMemo(() => new Set(Object.values(roster).map((p) => p.id)), [roster]);
  const open = SLOTS.filter((s) => !roster[s]);
  const capUsed = SLOTS.reduce((sum, s) => sum + (roster[s] ? playerSalary(roster[s]) : 0), 0);
  const capRemaining = GM_CAP - capUsed;

  useEffect(() => {
    (async () => {
      const { data } = await authGetSession();
      if (data?.session?.user) {
        const prof = await fetchProfile(data.session.user.id);
        if (prof) { setUserId(data.session.user.id); setUser(prof.username); setStats(prof); }
      }
      setAuthReady(true);
    })();
    const { data: authSub } = authOnChange((event) => {
      if (event === "SIGNED_OUT") { setUserId(null); setUser(null); setStats(null); }
    });
    loadLeaderboard();
    (async () => {
      setDailyDone(await sget(DAILY_KEY(todayKey()), false));
      const saved = await sget(DRAFT_KEY, false);
      const ok = saved && saved.spin && BOARDS[`${saved.spin.team}|${saved.spin.w}`] && Array.isArray(saved.history)
        && saved.history.every((h) => findPlayer(h.key, h.id, h.season));
      if (ok && saved.history.length > 0 && saved.mode) restoreDraft(saved);
      refreshWip();
      setDraftReady(true);
      if (!(await sget(HOWTO_KEY, false))) setHowTo(true);
    })();
    return () => { clearInterval(timer.current); authSub?.subscription?.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in progress on this device so a reload doesn't lose it
  useEffect(() => {
    if (!draftReady || result || !spin || spinning || !mode) return;
    const snap = { history, spin, used, rerolls, mode, seq, seqIdx };
    sset(DRAFT_KEY, snap, false);
    sset(mode.kind === "daily" ? DAILY_PROGRESS(mode.date) : FREE_PROGRESS, snap, false);
    setWip((w) => ({ ...w, [mode.kind]: history.length }));
  }, [draftReady, history, spin, used, rerolls, mode, seq, seqIdx, result, spinning]);

  // Show the compact team bar once the big scoreboard scrolls out of view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") { setStuck(false); return; }
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => { io.disconnect(); setStuck(false); };
  }, [view, !!result, !!spin]);

  // top/totals/myRank replace the old "fetch every stats row, derive everything client-side"
  // approach - each is now its own targeted query (see storage.js), so this scales past a
  // handful of players instead of loading the entire table on every leaderboard view.
  async function loadLeaderboard() {
    setLb((x) => ({ ...x, loading: true, error: false }));
    try {
      const [top, totals] = await Promise.all([fetchLeaderboardTop(10), fetchSiteTotals()]);
      const myKey = user ? user.toLowerCase() : null;
      let myRank = -1;
      if (myKey) {
        const idx = top.findIndex((q) => q.id === myKey);
        myRank = idx >= 0 ? idx : stats?.bestScore != null ? await fetchOwnRank(stats.bestScore) : -1;
      }
      setLb({ loading: false, top, totals, myRank, error: false });
    } catch (e) {
      setLb({ loading: false, top: [], totals: { runs: 0, perfect: 0, players: 0 }, myRank: -1, error: true });
    }
  }

  async function saveStats(s) {
    setStats(s);
    const ok = await updateProfile(userId, s);
    setSaveError(!ok);
  }

  async function onAuthed(uid, username, isNew) {
    let s = (await fetchProfile(uid)) || blankStats(username);
    const notes = [];
    if (isNew) {
      // bring over seasons played on this device before accounts existed
      const old = await sget(OLD_PROFILE, false);
      if (old && old.runs > 0) {
        s = { ...s, runs: s.runs + old.runs, wins: s.wins + (old.wins || 0), losses: s.losses + (old.losses || 0),
          champs: s.champs + (old.champs || 0), perfect: s.perfect + (old.perfect || 0), playoffs: s.playoffs + (old.playoffs || 0),
          bestScore: old.bestScore ?? s.bestScore, bestRun: old.bestRun || s.bestRun,
          bestRecord: old.bestRecord || s.bestRecord, recent: (old.recent || []).slice(0, 10) };
        await sdel(OLD_PROFILE, false);
        notes.push(`${old.runs} earlier season${old.runs > 1 ? "s were" : " was"} added to your account.`);
      }
    }
    if (pending) {
      s = applyRun(s, pending);
      notes.push("Your last season was saved.");
      setPending(null);
    }
    setUserId(uid);
    setUser(username);
    setNotice(notes.join(" "));
    // Not saveStats(s) here - that closes over the `userId` state, which hasn't committed yet
    // in this same synchronous pass (setUserId above is async). Use the fresh `uid` directly.
    setStats(s);
    const ok = await updateProfile(uid, s);
    setSaveError(!ok);
  }

  async function logOut() {
    await authSignOut();
    setUserId(null); setUser(null); setStats(null); setNotice("");
  }

  // pin holds one axis fixed at target's value during the animation - used by reroll() so
  // re-spinning the team doesn't also visibly cycle the years reel, and vice versa. null
  // (a fresh board reveal) spins both.
  function animateTo(target, pin = null) {
    clearInterval(timer.current);
    setSelected(null);
    if (reducedMotion()) { setSpin(target); setDisplay(target); return; }
    setSpinning(true);
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      setDisplay({
        team: pin === "team" ? target.team : pick(TEAM_CODES),
        w: pin === "years" ? target.w : Math.floor(Math.random() * WINDOWS.length),
      });
      if (n >= 14) { clearInterval(timer.current); setSpin(target); setDisplay(target); setSpinning(false); }
    }, 65);
  }

  // Every draft runs off a seed, so a daily or a shared code gives the same boards to everyone.
  // Alternates further down the sequence cover re-spins and boards with nothing draftable left.
  function boardAt(list, from, r) {
    const d = new Set(Object.values(r).map((p) => p.id));
    const o = SLOTS.filter((s) => !r[s]);
    for (let i = from; i < list.length; i++) if (boardHasOption(list[i], d, o)) return i;
    return -1;
  }

  // Both an unlimited draft and the daily can sit half-finished at once; each keeps its own slot.
  async function refreshWip() {
    const [f, d] = await Promise.all([sget(FREE_PROGRESS, false), sget(DAILY_PROGRESS(todayKey()), false)]);
    setWip((w) => {
      const next = { ...w };
      if (pendingClears.current.free === 0) next.free = validDraft(f) ? f.history.length : 0;
      if (pendingClears.current.daily === 0) next.daily = validDraft(d) ? d.history.length : 0;
      return next;
    });
  }

  function restoreDraft(saved) {
    const r = {};
    saved.history.forEach((h) => { r[h.slot] = findPlayer(h.key, h.id, h.season); });
    setRoster(r); setHistory(saved.history); setUsed(saved.used || []);
    setRerolls(saved.rerolls || { team: 1, years: 1 });
    setMode(saved.mode); setSeq(saved.seq || []); setSeqIdx(saved.seqIdx || 0);
    setSpin(saved.spin); setDisplay(saved.spin); setResult(null); setSelected(null);
    setShown(0); setPo({ idx: 0, stage: "pre" }); setResumed(true);
    setWip((w) => ({ ...w, [saved.mode.kind]: saved.history.length }));
  }

  const validDraft = (s) => s && s.spin && s.mode && Array.isArray(s.history) && s.history.length > 0
    && BOARDS[`${s.spin.team}|${s.spin.w}`] && s.history.every((h) => findPlayer(h.key, h.id, h.season));

  // presetRoster (Build-a-player) pre-fills one slot before the sequence is walked, so boardAt
  // correctly treats that position as already spoken for from the very first board.
  function startDraft(m, presetRoster) {
    const seed = m.kind === "daily" ? `daily-${m.date}` : m.code;
    const list = seededSequence(seed);
    const initialRoster = presetRoster || {};
    setMode({ ...m, seed }); setSeq(list);
    setRoster(initialRoster); setHistory([]); setUsed([]); setSelected(null); setResult(null);
    setShown(0); setPo({ idx: 0, stage: "pre" }); setRerolls({ team: 1, years: 1 });
    setPending(null); setNotice(""); setResumed(false); setConfirmReset(false);
    setShare({ state: "idle", text: "" });
    const i = boardAt(list, 0, initialRoster);
    setSeqIdx(i);
    const [t, w] = list[i].split("|");
    animateTo({ team: t, w: Number(w) });
  }

  function advance(r, from) {
    const i = boardAt(seq, from, r);
    if (i < 0) return false;
    setSeqIdx(i);
    const [t, w] = seq[i].split("|");
    animateTo({ team: t, w: Number(w) });
    return true;
  }

  // A re-spin keeps one half of the board fixed and pulls the next matching alternate.
  function reroll(kind) {
    if (!spin || spinning || rerolls[kind] < 1) return;
    const d = new Set(Object.values(roster).map((p) => p.id));
    const o = SLOTS.filter((s) => !roster[s]);
    // Every board already shown OR still queued later in this draft's planned sequence is off
    // the table for a reroll - once a team+years pair is anywhere in the plan, it's used up.
    // (This also rules out reusing an entry from seq's own remaining tail: doing so would
    // insert a second copy without removing the original, so that board would resurface again
    // later when sequential advancement reaches its old spot.)
    const shown = new Set(seq);
    const match = (key) => {
      const [t, w] = key.split("|");
      return !shown.has(key) && (kind === "team" ? Number(w) === spin.w : t === spin.team) && boardHasOption(key, d, o);
    };
    const rng = mulberry32(hashStr(`${mode.seed}-reroll-${kind}-${seqIdx}`));
    const pool = Object.keys(BOARDS).filter(match);
    if (!pool.length) return;
    const next = pool[Math.floor(rng() * pool.length)];
    const n = [...seq]; n.splice(seqIdx + 1, 0, next);
    setSeq(n); setSeqIdx(seqIdx + 1); setUsed([...used, next]);
    const [t, w] = next.split("|");
    animateTo({ team: t, w: Number(w) }, kind === "team" ? "years" : "team");
    setRerolls({ ...rerolls, [kind]: rerolls[kind] - 1 });
  }

  // keyOverride lets the admin panel force-draft a player from a board other than the one
  // currently spinning, without waiting on setSpin() to commit first.
  function draft(player, slot, keyOverride) {
    const key = keyOverride || `${spin.team}|${spin.w}`;
    const best = bestAvailable(key, [...drafted], open);
    setHistory((hs) => [...hs, { key, id: player.id, season: player.season, slot, bestId: best ? best.id : player.id, bestSeason: best ? best.season : player.season }]);
    setResumed(false);
    const next = { ...roster, [slot]: player };
    setRoster(next);
    setSelected(null);
    const el = draftTop.current;
    if (el && el.scrollIntoView && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    if (SLOTS.every((s) => next[s])) finish(next);
    else advance(next, seqIdx + 1);
  }

  // forcedScenario (admin-only) skips the real simulation for a scripted ending, and skips
  // every persistence side effect below so testing an animation never touches real stats,
  // the leaderboard, or daily/draft progress.
  function finish(r, forcedScenario) {
    let tot = 0, wt = 0;
    for (const s of SLOTS) { const k = s === "QB" ? QB_WEIGHT : 1; tot += effectiveRating(s, r[s]) * k; wt += k; }
    const score = Math.round((tot / wt) * 10) / 10;
    const lineup = SLOTS.map((s) => `${r[s].id}${r[s].season}`).join("|");
    const sim = forcedScenario ? forceSeason(forcedScenario) : withSeed(`${mode.seed}#${lineup}`, () => simulateSeason(score));
    sim.score = score;
    const run = {
      w: sim.w, l: sim.l, score, outcome: sim.outcome, champ: sim.champ, perfect: sim.perfect, playoffs: sim.playoffs, date: Date.now(),
      roster: SLOTS.map((s) => ({ slot: s, name: r[s].name, team: r[s].team, season: r[s].season, ppr: r[s].ppr, rating: effectiveRating(s, r[s]) })),
    };
    const siteBest = lb.top[0]?.bestScore ?? 0;
    sim.newSiteBest = !forcedScenario && !!user && lb.top.length > 0 && score > siteBest;
    setNotice("");
    run.mode = mode.kind;
    run.code = mode.code;
    if (!forcedScenario) {
      if (mode.kind === "daily") {
        const rec = { date: mode.date, w: sim.w, l: sim.l, score, outcome: sim.outcome, roster: run.roster };
        setDailyDone(rec);
        sset(DAILY_KEY(mode.date), rec, false);
        if (user) upsertDailyRun(mode.date, userId, { username: user, w: sim.w, l: sim.l, score, outcome: sim.outcome });
      }
      if (user && stats) {
        sim.newBestScore = stats.bestScore == null || score > stats.bestScore;
        let s = applyRun(stats, run);
        if (mode.kind === "daily") {
          const st = nextStreak(s, mode.date);
          s = { ...s, dailyLast: mode.date, dailyStreak: st, dailyBestStreak: Math.max(st, s.dailyBestStreak || 0) };
        }
        saveStats(s);
      } else {
        setPending(run);
      }
      loadLeaderboard(); // fresh numbers for the sitewide ranking
      clearDraft(DRAFT_KEY);
      clearDraftTracked(mode.kind, mode.kind === "daily" ? DAILY_PROGRESS(mode.date) : FREE_PROGRESS);
      setWip((w) => ({ ...w, [mode.kind]: 0 }));
    }
    setShare({ state: "idle", text: "" });
    setResult(sim);
    setPo({ idx: 0, stage: "pre" });
    setShown(reducedMotion() ? sim.games.filter((g) => !g.playoff).length : 0);
  }

  // ---------- Admin testing tools ----------
  const isAdmin = user && user.toLowerCase() === "admin";

  function adminForceBoard(team, w) {
    if (!mode) return;
    const key = `${team}|${w}`;
    if (!BOARDS[key] || !BOARDS[key].length) return;
    const n = [...seq]; n.splice(seqIdx + 1, 0, key);
    setSeq(n); setSeqIdx(seqIdx + 1);
    clearInterval(timer.current);
    setSpinning(false);
    setSelected(null);
    setSpin({ team, w }); setDisplay({ team, w });
  }

  function adminForcePlayer(player, slot) {
    adminForceBoard(player.team, player.w);
    draft(player, slot, `${player.team}|${player.w}`);
  }

  // Fills any still-open slots with the first eligible player found (admin doesn't need a
  // "real" roster to check an ending animation), then jumps straight to the scripted result.
  function adminForceOutcome(scenarioKey) {
    const next = { ...roster };
    const ids = new Set(Object.values(next).map((p) => p.id));
    for (const s of SLOTS) {
      if (next[s]) continue;
      for (const key of Object.keys(BOARDS)) {
        const cand = BOARDS[key].find((p) => !ids.has(p.id) && fits(p.pos, s));
        if (cand) { next[s] = cand; ids.add(cand.id); break; }
      }
    }
    setRoster(next);
    finish(next, scenarioKey);
  }

  useEffect(() => {
    // regular season ticks by quickly; playoff games are played one at a time
    if (!result || shown >= result.games.filter((g) => !g.playoff).length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 90);
    return () => clearTimeout(t);
  }, [result, shown]);

  // Ending an unlimited draft early is a DNF; the draft itself is cleared.
  function abandonCurrent() {
    if (mode && mode.kind === "free" && !result && history.length > 0 && user && stats) saveStats(applyDnf(stats, history.length));
    clearDraftTracked("free", FREE_PROGRESS);
    setWip((w) => ({ ...w, free: 0 }));
  }

  function restart(extra) {
    abandonCurrent();
    clearDraft(DRAFT_KEY);
    setView("play");
    startDraft({ kind: "free", code: newCode(), ...extra });
  }

  // Stats O/U: "career" here means the sum of a player's appearances across every board he
  // qualified for (at most one season per team per era window) - a real but partial slice of
  // his career, not his true full stat line, since only qualifying seasons make the boards.
  function newSouRound() {
    const id = SOU_PLAYER_IDS[Math.floor(Math.random() * SOU_PLAYER_IDS.length)];
    const appearances = [];
    for (const key of Object.keys(BOARDS)) {
      for (const p of BOARDS[key]) if (p.id === id) appearances.push(p);
    }
    const [statKey, statLabel] = SOU_STAT[appearances[0].pos];
    const trueValue = appearances.reduce((sum, p) => sum + (p[statKey] || 0), 0);
    let line = Math.round((trueValue * (0.8 + Math.random() * 0.4)) / 25) * 25;
    if (line === trueValue) line += 25;
    const teams = [...new Set(appearances.map((p) => TEAMS[p.team][0]))];
    setSouRound({ name: appearances[0].name, pos: appearances[0].pos, teams, statLabel, trueValue, line, guess: null });
  }

  function souGuess(dir) {
    if (souRound.guess) return;
    const correct = dir === "over" ? souRound.trueValue > souRound.line : souRound.trueValue < souRound.line;
    setSouRound({ ...souRound, guess: dir, correct });
    setSouScore((s) => (correct ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }));
  }

  // Build-a-player: assigns a random position, then rolls real players at that position one at
  // a time so you can pick a single stat category from each until every category is filled.
  function rollBapCandidate(pos) {
    const keys = Object.keys(BOARDS);
    for (let tries = 0; tries < 50; tries++) {
      const pool = BOARDS[keys[Math.floor(Math.random() * keys.length)]].filter((p) => p.pos === pos);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return null;
  }

  function startBuild() {
    const pos = POS[Math.floor(Math.random() * POS.length)];
    setView("buildplayer");
    setBap({ pos, filled: {}, contributors: [], remaining: BUILD_CATEGORIES[pos].map(([k]) => k), roll: rollBapCandidate(pos) });
  }

  function pickBapStat(catKey) {
    const filled = { ...bap.filled, [catKey]: bap.roll[catKey] };
    const contributors = [...bap.contributors, bap.roll];
    const remaining = bap.remaining.filter((k) => k !== catKey);
    if (!remaining.length) { finishBuild(bap.pos, filled, contributors); return; }
    setBap({ pos: bap.pos, filled, contributors, remaining, roll: rollBapCandidate(bap.pos) });
  }

  // The custom player's rating is the average of whoever he was assembled from - not a real
  // grade (nothing like it exists for a Frankenstein stat line), just enough to slot him into
  // the same team-score math every other player uses.
  function finishBuild(pos, filled, contributors) {
    const rating = Math.round((contributors.reduce((a, p) => a + p.rating, 0) / contributors.length) * 10) / 10;
    const s = { cmp: 0, att: 0, py: 0, ptd: 0, int: 0, car: 0, ry: 0, rtd: 0, rec: 0, rcy: 0, rctd: 0, fl: 0, ...filled };
    const ppr = Math.max(0, Math.round((s.py / 25 + s.ptd * 4 - s.int * 2 + s.ry / 10 + s.rtd * 6 + s.rec + s.rcy / 10 + s.rctd * 6 - s.fl * 2) * 10) / 10);
    const customPlayer = { id: `custom-${Date.now()}`, name: `Your custom ${POS_NAME[pos].replace(/s$/, "")}`, pos, season: "Custom", g: 16, team: contributors[0].team, w: 0, ...s, ppr, rating };
    setBap(null);
    setView("play");
    startDraft({ kind: "free", code: newCode(), build: true }, { [pos]: customPlayer });
  }

  // Today's daily always picks up where it left off: you get one run at it, not one per visit.
  async function startDaily() {
    setView("play");
    const d = todayKey();
    if (mode && mode.kind === "daily" && mode.date === d && !dailyDone) return;
    const saved = await sget(DAILY_PROGRESS(d), false);
    if (!dailyDone && validDraft(saved) && saved.mode.date === d) { restoreDraft(saved); return; }
    startDraft({ kind: "daily", date: d, code: `DAILY-${d}` });
  }

  // Unlimited: pick up the half-finished one if there is one, otherwise deal a fresh board.
  // Genius/GM mode are the same free-draft slot with a flag that changes how it's played - but
  // tapping a variant that doesn't match what's actually saved there (e.g. a Genius draft is
  // half-finished and you tap GM mode) must not silently resume it under the wrong flags. Treat
  // that as abandoning the old variant (a DNF, same as any other abandoned unlimited draft) and
  // dealing a fresh board in the variant actually requested.
  async function openFree(extra) {
    setView("play");
    const sameVariant = (m) => !!m?.genius === !!extra?.genius && !!m?.gm === !!extra?.gm;
    if (mode && mode.kind === "free" && sameVariant(mode) && !result && history.length > 0) return;
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free") {
      if (sameVariant(saved.mode)) { restoreDraft(saved); return; }
      // Use the saved history length (not live state) so the DNF is recorded correctly even if
      // this draft was started in an earlier session and never loaded back into memory.
      if (user && stats) saveStats(applyDnf(stats, saved.history.length));
      clearDraftTracked("free", FREE_PROGRESS);
      setWip((w) => ({ ...w, free: 0 }));
    }
    clearDraft(DRAFT_KEY);
    startDraft({ kind: "free", code: newCode(), ...extra });
  }

  function startCode(raw) {
    const code = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (code.length < 4) return;
    abandonCurrent();
    clearDraft(DRAFT_KEY);
    setCodeInput("");
    setView("play");
    startDraft({ kind: "free", code });
  }

  async function loadDailyBoard() {
    setDailyBoard({ loading: true, rows: [] });
    try {
      const rows = await fetchDailyTop(todayKey(), 10);
      setDailyBoard({ loading: false, rows });
    } catch (e) { setDailyBoard({ loading: false, rows: [] }); }
  }

  // Two taps to reset, so a stray tap can't wipe out a draft
  function resetDraft() {
    if (mode && mode.kind === "daily") return;
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
      return;
    }
    setConfirmReset(false);
    if (user && stats) saveStats(applyDnf(stats, history.length));
    restart();
  }

  function closeHowTo() { setHowTo(false); sset(HOWTO_KEY, true, false); }

  async function doShare() {
    const text = shareText(result, roster, place, mode);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ text });
        setShare({ state: "shared", text }); return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try {
      await navigator.clipboard.writeText(text);
      setShare({ state: "copied", text });
      setTimeout(() => setShare((s) => (s.state === "copied" ? { ...s, state: "idle" } : s)), 2500);
    } catch (e) {
      setShare({ state: "manual", text }); // clipboard blocked: show the text to copy by hand
    }
  }

  // ---------- Derived ----------
  const board = spin ? BOARDS[`${spin.team}|${spin.w}`] : [];
  const pickNo = SLOTS.length - open.length + 1;
  const disp = display || spin;
  const selSlots = selected ? open.filter((s) => fits(selected.pos, s)) : [];
  // 0 = its own slot is open, 1 = own slot filled but Flex still open, 2 = nowhere left to put them
  const secState = (pos) => (!roster[pos] ? 0 : open.some((s) => fits(pos, s)) ? 1 : 2);

  const siteBest = lb.top[0];
  const totals = lb.totals;
  const perfectPct = totals.runs > 0 ? Math.round((100 * totals.perfect) / totals.runs) : 0;
  const myKey = user ? user.toLowerCase() : null;
  const myRank = lb.myRank;
  const regGames = result ? result.games.filter((g) => !g.playoff) : [];
  const poGames = result ? result.games.filter((g) => g.playoff) : [];
  const inPlayoffs = !!result && shown >= regGames.length && poGames.length > 0 && po.stage !== "done";
  const finished = !!result && shown >= result.games.length && !inPlayoffs;
  const regW = regGames.filter((g) => g.win).length;
  const inProgress = !!mode && !result && history.length > 0 && history.length < 6;
  const freePicks = (mode && mode.kind === "free" && !result ? history.length : wip.free) || 0;
  const dailyPicks = dailyDone ? 0 : ((mode && mode.kind === "daily" && mode.date === todayKey() && !result ? history.length : wip.daily) || 0);
  // Ranks this run against everyone's BEST-ever score (via myRank, already refreshed by the
  // loadLeaderboard() call in finish()) rather than against every run ever played - a real
  // per-run leaderboard would need a full runs log table this schema doesn't have. For a new
  // personal best this is exactly right; for a non-best run it shows the existing best's rank.
  const place = finished && !lb.error && myRank >= 0 ? { rank: myRank + 1, total: totals.players } : null;
  function skipPlayoffs() { setShown(result.games.length); setPo({ idx: 0, stage: "done" }); }

  return (
    <div className="ps">
      <style>{CSS}</style>
      <div className="wrap">
        <nav className="nav" aria-label="Sections">
          {[["home", "Modes"], ["play", "Draft"], ["profile", user ? "Profile" : "Account"], ["board", "Leaderboard"]].map(([k, l]) => (
            <button key={k} className={`tab ${view === k ? "on" : ""}`} aria-current={view === k ? "page" : undefined}
              onClick={() => { setView(k); if (k === "home") refreshWip(); if (k === "board") { loadLeaderboard(); loadDailyBoard(); } }}>
              {l}{k === "play" && view !== "play" && mode && open.length < 6 && !result && <span className="dot" aria-label="Draft in progress" />}
            </button>
          ))}
          <div className="hdr-links">
            <button className="linkbtn" onClick={() => setHowTo(true)}>How to play</button>
            {!user && authReady && <button className="linkbtn" onClick={() => setView("profile")}>Log in</button>}
            {user && <span className="whoami">{user}</span>}
          </div>
        </nav>

        {saveError && <div className="panel"><p style={{ margin: 0 }}>Your last season couldn't be saved. It will be included the next time a save goes through.</p></div>}
        {notice && <div className="panel"><p style={{ margin: 0 }}>{notice}</p></div>}
        {howTo && <HowTo onClose={closeHowTo} />}
        {resumed && view === "play" && !result && (
          <div className="notice"><span>Picked up your draft where you left off.</span></div>
        )}

        {/* ---------------- HOME ---------------- */}
        {view === "home" && (
          <>
            <header className="hero">
              <div className="brand">
                <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
                  <ellipse cx="24" cy="24" rx="21" ry="13" transform="rotate(-35 24 24)" fill="#F7B32B" />
                  <ellipse cx="24" cy="24" rx="21" ry="13" transform="rotate(-35 24 24)" fill="none" stroke="#14161B" strokeOpacity=".35" strokeWidth="1.5" />
                  <g transform="rotate(-35 24 24)" stroke="#14161B" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="15" y1="24" x2="33" y2="24" />
                    <line x1="18" y1="21" x2="18" y2="27" /><line x1="22" y1="21" x2="22" y2="27" /><line x1="26" y1="21" x2="26" y2="27" /><line x1="30" y1="21" x2="30" y2="27" />
                  </g>
                </svg>
                <h1 className="title">Perfect Season</h1>
              </div>
              <p className="sub">Draft six players from random teams and eras. The stats are real, the fantasy points are hidden, and your lineup plays a full season against real NFL teams. Win all 20 and you've gone perfect.</p>
            </header>

            <div className="modes">
              <button className="mode daily" onClick={startDaily}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">📅</span>
                  <span className="mn">Daily challenge</span>
                  {stats?.dailyStreak && stats.dailyLast === todayKey() ? <span className="pill">{stats.dailyStreak} day streak</span> : null}
                  {dailyPicks > 0 && <span className="pill">{dailyPicks} of 6 picked</span>}
                </div>
                <p>The same six boards for everyone, one draft a day, no resets. {prettyDate(todayKey())}.</p>
                <span className="go">{dailyDone ? "See today's result" : dailyPicks > 0 ? "Finish today's daily" : "Play today's daily"}</span>
              </button>

              <button className="mode m-unlimited" onClick={() => openFree()}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">♾️</span>
                  <span className="mn">Unlimited</span>{freePicks > 0 && <span className="pill">{freePicks} of 6 picked</span>}
                </div>
                <p>Draft as many teams as you like. Random boards every time, resets allowed.</p>
                <span className="go">{freePicks > 0 ? "Back to your draft" : "Start a draft"}</span>
              </button>

              <button className="mode m-genius" onClick={() => openFree({ genius: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">🧠</span><span className="mn">Genius mode</span></div>
                <p>Same draft, no stats shown. Just name, team, and year - know your football. Shares your Unlimited progress slot.</p>
                <span className="go">Start a draft</span>
              </button>

              <button className="mode m-gm" onClick={() => openFree({ gm: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">💼</span><span className="mn">GM mode</span></div>
                <p>Draft against a ${GM_CAP}M salary cap. Elite seasons cost a lot more. Shares your Unlimited progress slot.</p>
                <span className="go">Start a draft</span>
              </button>

              <button className="mode m-sou" onClick={() => { setView("statsou"); if (!souRound) newSouRound(); }}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">📊</span>
                  <span className="mn">Stats O/U</span>{(souScore.right + souScore.wrong) > 0 && <span className="pill">{souScore.right}–{souScore.wrong}</span>}
                </div>
                <p>Guess over or under a player's stat line. No drafting, just know your football.</p>
                <span className="go">Play</span>
              </button>

              <button className="mode m-bap" onClick={startBuild}>
                <div className="mt"><span className="icon" aria-hidden="true">🧩</span><span className="mn">Build-a-player</span></div>
                <p>Roll real players and take one stat from each to stitch together a custom season, then draft the rest and sim it.</p>
                <span className="go">Play</span>
              </button>

              <div className="mode static">
                <div className="mt"><span className="icon" aria-hidden="true">🔗</span><span className="mn">Challenge a friend</span></div>
                <p>Enter a code to draft the exact same boards someone else had.</p>
                <div className="frow">
                  <input className="inp" value={codeInput} maxLength={8} placeholder="Code, e.g. K3F9QZ" aria-label="Challenge code"
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && startCode(codeInput)} />
                  <button className="btn solid" disabled={codeInput.trim().length < 4} onClick={() => startCode(codeInput)}>Draft it</button>
                </div>
              </div>
            </div>

            <div className="hometiles">
              <div className="tile"><div className="n">{user && stats ? draftsOf(stats) : "–"}</div><div className="l">Your drafts</div></div>
              <div className="tile"><div className="n">{user && stats?.bestRecord ? `${stats.bestRecord.w}–${stats.bestRecord.l}` : "–"}</div><div className="l">Your best record</div></div>
              <div className="tile"><div className="n">{siteBest ? siteBest.bestScore.toFixed(1) : "–"}</div><div className="l">Best score sitewide</div></div>
            </div>

            {!lb.loading && totals.players > 0 && (
              <div className="panel" style={{ marginTop: 14 }}>
                <h3 style={{ marginTop: 0 }}>Sitewide</h3>
                <div className="hometiles">
                  <div className="tile"><div className="n">{totals.runs.toLocaleString()}</div><div className="l">Drafts played</div></div>
                  <div className="tile"><div className="n">{totals.players.toLocaleString()}</div><div className="l">Players</div></div>
                  <div className="tile"><div className="n">{totals.perfect.toLocaleString()}</div><div className="l">Perfect seasons</div></div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                    <span>Drafts that went 20–0</span><span>{perfectPct}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(perfectPct, totals.perfect > 0 ? 2 : 0)}%`, background: "var(--lamp)", borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            )}
            {!user && authReady && (
              <p className="note">Playing as a guest. <button className="linkbtn" onClick={() => setView("profile")}>Log in or create an account</button> to save your drafts, keep a daily streak, and get on the leaderboard.</p>
            )}
          </>
        )}

        {/* ---------------- PLAY ---------------- */}
        {view === "play" && !mode && (
          <div className="locked">
            <h3>No draft going right now</h3>
            <p className="note" style={{ marginTop: 0 }}>Pick a mode to start one.</p>
            <div className="frow" style={{ marginTop: 10 }}>
              <button className="btn solid" onClick={startDaily}>Play today's daily</button>
              <button className="btn" onClick={() => openFree()}>Unlimited draft</button>
            </div>
          </div>
        )}

        {view === "play" && mode && (
          <>
            {mode && (
              <div className="modebar">
                <button className={`mb ${mode.kind === "free" ? "on" : ""}`} onClick={() => mode.kind !== "free" && restart()}>Unlimited</button>
                <button className={`mb ${mode.kind === "daily" ? "on" : ""}`} onClick={() => mode.kind !== "daily" && startDaily()}>
                  Daily{stats?.dailyStreak && stats.dailyLast === todayKey() ? ` · ${stats.dailyStreak}🔥` : ""}
                </button>
                <button className="mb" onClick={() => { refreshWip(); setView("home"); }}>All modes</button>
                {mode.kind === "daily" ? (
                  <span className="seedline">{prettyDate(mode.date)} · same boards for everyone</span>
                ) : (
                  <span className="seedline">{mode.genius && "Genius mode · "}{mode.gm && "GM mode · "}Code <code>{mode.code}</code></span>
                )}
              </div>
            )}

            {isAdmin && mode && !result && (
              <AdminPanel openSlots={open} onForceBoard={adminForceBoard} onForcePlayer={adminForcePlayer} onForceOutcome={adminForceOutcome} />
            )}

            {mode && mode.kind === "daily" && dailyDone && !result && (
              <div className="locked">
                <h3>Today's daily is done</h3>
                <p className="note" style={{ marginTop: 0 }}>You went {dailyDone.w}–{dailyDone.l} with a team score of {dailyDone.score.toFixed(1)}. {dailyDone.outcome}.</p>
                <RosterRows roster={dailyDone.roster} />
                <div className="frow" style={{ marginTop: 12 }}>
                  <button className="btn solid" onClick={restart}>Play an unlimited draft</button>
                  <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>Today's leaderboard</button>
                </div>
              </div>
            )}

            {!(mode && mode.kind === "daily" && dailyDone && !result) && (
            <>
            {mode.gm && !result && (
              <div className="frow" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Salary cap</span>
                <span style={{ fontWeight: 700, color: capRemaining < 0 ? "var(--loss)" : "var(--ink)" }}>${capUsed}M / ${GM_CAP}M</span>
              </div>
            )}
            <div className="roster" aria-label="Your roster" ref={draftTop} style={{ scrollMarginTop: 12 }}>
              {SLOTS.map((s) => {
                const p = roster[s];
                const target = selSlots.includes(s);
                return (
                  <button key={s} className={`slot pos-${s.startsWith("FLEX") ? "FLEX" : s} ${p ? "filled" : ""} ${target ? "target" : ""}`}
                    disabled={!target} onClick={() => target && draft(selected, s)}
                    aria-label={p ? `${SLOT_LABEL[s]}: ${p.name}` : target ? `Draft ${selected.name} to ${SLOT_LABEL[s]}` : `${SLOT_LABEL[s]} open`}>
                    <div className="k">{SLOT_LABEL[s]}</div>
                    <div className="v">{p ? p.name : target ? "Draft here" : <span style={{ color: "var(--muted)", fontWeight: 400 }}>Open</span>}</div>
                    {p && <div className="sub">{shortYr(p.season)} {TEAMS[p.team][0]}{s.startsWith("FLEX") ? `, ${p.pos}` : ""}</div>}
                  </button>
                );
              })}
            </div>

            {!result && disp && (
              <>
                <div className={`sticky ${stuck ? "show" : ""}`} aria-hidden={!stuck} style={teamVars(disp.team)}>
                  <div className="in">
                    <div className="stripe" style={{ background: TEAMS[disp.team][2] }} />
                    <span className="tm">{TEAMS[disp.team][0]}</span>
                    <span className="yr">{WINDOWS[disp.w][0]}–{WINDOWS[disp.w][1]}</span>
                    <span className="pk">Pick {pickNo} of 6</span>
                    <span className="brk" />
                    <div className="chips">
                      {SLOTS.map((s) => <span key={s} className={`chip pos-${s.startsWith("FLEX") ? "FLEX" : s} ${roster[s] ? "on" : ""}`} title={roster[s] ? roster[s].name : `${SLOT_LABEL[s]} open`}>{s.startsWith("FLEX") ? "FX" : s}</span>)}
                    </div>
                    <div className="sp">
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>Re-spin team ({rerolls.team})</button>
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>Re-spin years ({rerolls.years})</button>
                    </div>
                  </div>
                </div>
                <div className={`reel ${spinning ? "spin" : ""}`} aria-live="polite" style={teamVars(disp.team)}>
                  <div className="stripe" style={{ background: TEAMS[disp.team][2] }} />
                  <div className="pickno"><span>Pick {pickNo} of 6</span><span>{spinning ? "Spinning" : `${board.length} players on the board`}</span></div>
                  <div className="team">{TEAMS[disp.team][0]}</div>
                  <div><span className="years led-wrap"><span className="led">{WINDOWS[disp.w][0]}–{WINDOWS[disp.w][1]}</span></span>{cityRange(disp.team, disp.w) && <span className="city">{cityRange(disp.team, disp.w)}</span>}</div>
                </div>
                <div className="rerolls">
                  <button className="btn" disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>Re-spin team ({rerolls.team} left)</button>
                  <button className="btn" disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>Re-spin years ({rerolls.years} left)</button>
                  {mode.kind === "daily" ? (
                    <span className="note" style={{ marginLeft: "auto", alignSelf: "center" }}>One shot. No resets on the daily.</span>
                  ) : (
                    <button className={`btn reset ${confirmReset ? "armed" : ""}`} disabled={spinning} onClick={resetDraft}>
                      {confirmReset ? (user ? "Tap again: counts as a DNF" : "Tap again to reset") : "Reset draft"}
                    </button>
                  )}
                </div>
                <div ref={sentinel} aria-hidden="true" />

                {/* Only a truly-done position (state 2) sinks to the bottom - a filled named
                    slot that's still flex-eligible (state 1) stays put next to open ones. */}
                {!spinning && [...POS].sort((a, b) => (secState(a) === 2 ? 1 : 0) - (secState(b) === 2 ? 1 : 0)).map((pos) => {
                  const list = board.filter((p) => p.pos === pos);
                  if (!list.length) return null;
                  const st = secState(pos);
                  const collapsed = st === 2 && !showDone[pos];
                  return (
                    <section className={`sec pos-${pos} ${st === 2 ? "done" : ""}`} key={pos}>
                      <div className="hd">
                        <h3>{POS_NAME[pos]}</h3>
                        {st === 1 && <span className="nt">{pos} spot filled. These players can still go to Flex.</span>}
                        {st === 2 && (
                          <button className="linkbtn" onClick={() => setShowDone({ ...showDone, [pos]: !showDone[pos] })}>
                            {collapsed ? `Spot filled. Show ${list.length} player${list.length > 1 ? "s" : ""}` : "Hide"}
                          </button>
                        )}
                      </div>
                      {!collapsed && list.map((p) => {
                        const slotsFor = open.filter((s) => fits(p.pos, s));
                        const off = drafted.has(p.id) || !slotsFor.length;
                        const isSel = selected && selected.id === p.id && selected.season === p.season;
                        return (
                          <div key={`${p.id}-${p.season}`} className={`card ${isSel ? "sel" : ""} ${off ? "off" : ""}`}>
                            <button className="hit" disabled={off} onClick={() => setSelected(isSel ? null : p)} aria-expanded={isSel}>
                              <div className="row">
                                <div>
                                  <div className="nm-row">
                                    <span className="pp">{p.pos}</span><span className="nm">{p.name}</span>
                                    {mode.gm && (
                                      <span className="pill" style={{ marginLeft: 8, color: playerSalary(p) > capRemaining ? "var(--loss)" : undefined }}>
                                        ${playerSalary(p)}M
                                      </span>
                                    )}
                                  </div>
                                  <div className="meta"><span className="tdot" style={teamVars(p.team)} />{p.season} {teamLabel(p.team, p.season)}, {p.g} games{drafted.has(p.id) ? ", already on your roster" : !slotsFor.length ? ", no open slot" : ""}</div>
                                </div>
                                {!mode.genius && (
                                  <div className="cells">
                                    {statCells(p).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
                                  </div>
                                )}
                              </div>
                            </button>
                            {isSel && (
                              <div className="drafts">
                                {slotsFor.map((s) => {
                                  const cost = mode.gm ? playerSalary(p) : 0;
                                  const tooExpensive = mode.gm && cost > capRemaining;
                                  return (
                                    <button key={s} className="btn solid" disabled={tooExpensive} onClick={() => draft(p, s)}>
                                      Draft to {SLOT_LABEL[s]}{mode.gm && ` - $${cost}M${tooExpensive ? " (over cap)" : ""}`}
                                    </button>
                                  );
                                })}
                                <button className="btn" onClick={() => setSelected(null)}>Cancel</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </>
            )}

            {result && (
              <>
                {finished && (result.perfect || result.champ) && (
                  <div className={`cel ${result.perfect ? "perfect" : ""}`}>
                    <Confetti n={result.perfect ? 34 : 22} />
                    <div className="big">{result.perfect ? "20–0" : "Champions"}</div>
                    <div className="sml">{result.perfect ? "A perfect season. Nobody touched you." : `You won it all at ${result.w}–${result.l}.`}</div>
                  </div>
                )}
                <div className="result-hero" aria-live="polite">
                  <div className="rec led-wrap"><span className="led">
                    {result.games.slice(0, shown).filter((g) => g.win).length}–{result.games.slice(0, shown).filter((g) => !g.win).length}
                  </span></div>
                  <div className="outcome">{finished ? result.outcome : inPlayoffs ? "Playoffs" : "Playing the season…"}</div>
                  <div className="rating">Team score {result.score.toFixed(1)}</div>
                  {finished && (
                    <div className="place">
                      {lb.loading && !place ? "Ranking your season…" : place && (
                        <>
                          <b>#{place.rank.toLocaleString()}</b> of {place.total.toLocaleString()} season{place.total === 1 ? "" : "s"} played sitewide
                          <span className="pct">{place.rank === 1 ? "Best ever" : topPct(place.rank, place.total)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {finished && (
                    <div>
                      {result.newSiteBest && <span className="badge">New sitewide best score</span>}
                      {result.newBestScore && !result.newSiteBest && <span className="badge">New personal best score</span>}
                    </div>
                  )}
                </div>

                {inPlayoffs && po.stage === "pre" && (
                  <div className="pre">
                    <h3>You're in the playoffs</h3>
                    <p>{regW}–{regGames.length - regW} in the regular season. {poGames[0].label === "Divisional" ? "That earns the top seed and a first-round bye." : "You're in as a wild card, so it's four wins to a title."}</p>
                    <div className="frow">
                      <button className="btn solid" onClick={() => setPo({ idx: 0, stage: "live" })}>Kick off the {poGames[0].label} round vs the {poGames[0].opp}</button>
                      <button className="linkbtn" onClick={skipPlayoffs}>Skip to the result</button>
                    </div>
                  </div>
                )}
                {inPlayoffs && po.stage === "live" && (
                  <PlayoffGame key={po.idx} game={poGames[po.idx]} roster={roster} instant={reducedMotion()}
                    onFinal={() => setShown((s) => s + 1)}
                    footer={po.idx < poGames.length - 1
                      ? <button className="btn solid" onClick={() => setPo({ idx: po.idx + 1, stage: "live" })}>Play the {poGames[po.idx + 1].label} round</button>
                      : <button className="btn solid" onClick={() => setPo({ idx: po.idx, stage: "done" })}>See your season</button>} />
                )}

                {finished && !user && pending && (
                  <AuthPanel onAuthed={onAuthed} title="Save this season"
                    blurb="Log in or create an account to keep this season in your stats and put your score on the leaderboard." />
                )}

                <h2 className="h">Season</h2>
                <div className="log">
                  {result.games.slice(0, shown).map((g, i) => (
                    <div key={i} className={`g ${g.win ? "win" : "loss"} ${g.playoff ? "po" : ""}`}>
                      <div className="o">{g.label}</div>
                      <div className="w">{g.win ? "W" : "L"} {g.us}–{g.them}</div>
                      <div className="o">{g.playoff || g.home ? "vs" : "at"} {g.opp}</div>
                    </div>
                  ))}
                </div>

                {finished && (
                  <>
                    <h2 className="h">Your roster, graded</h2>
                    <RosterRows roster={SLOTS.map((s) => ({ slot: s, ...roster[s], rating: effectiveRating(s, roster[s]) }))} />
                    <p className="note">Grades compare each season to the top fantasy finishers at that position in the same era, with 17-game seasons scaled to 16. QBs also gain or lose for passer rating and completion percentage, and RBs for yards per carry, against their era's average. Flex is graded on production alone, not position - no positional bump either way. Team score averages the six, with the QB counting 1.25 times.</p>
                    {history.length === 6 && (() => {
                      const rows = history.map((h, i) => {
                        const took = findPlayer(h.key, h.id, h.season);
                        const best = findPlayer(h.key, h.bestId, h.bestSeason) || took;
                        const [tm, w] = h.key.split("|");
                        return { i, took, best, gotIt: took.rating >= best.rating - 0.05, board: `${TEAMS[tm][0]} ${WINDOWS[w][0]}–${WINDOWS[w][1]}` };
                      });
                      const hits = rows.filter((r) => r.gotIt).length;
                      const optimal = bestOrderFor(history);
                      const totalWeight = SLOTS.reduce((t, s) => t + (s === "QB" ? QB_WEIGHT : 1), 0);
                      return (
                        <>
                          <h2 className="h" style={{ marginTop: 22 }}>Draft recap</h2>
                          <p className="recap-sum">You took the best available player on <b>{hits} of 6</b> boards.</p>
                          <div className="recap">
                            {rows.map((r) => (
                              <div className="rc" key={r.i}>
                                <div className="n">{r.i + 1}</div>
                                <div><div className="bd">{r.board}</div><div className="tk">{r.took.name} {shortYr(r.took.season)}<span className={`g2 ${gradeTier(r.took.rating)}`}>{grade(r.took.rating)}</span></div></div>
                                <div className="alt">{r.gotIt ? <span className="ok">Best on the board</span>
                                  : <>Best available: <b>{r.best.name} {shortYr(r.best.season)}</b> <span className={`g2 ${gradeTier(r.best.rating)}`}>{grade(r.best.rating)}</span></>}</div>
                              </div>
                            ))}
                          </div>
                          <p className="note">"Best available" means the highest-graded player you could still fit into an open spot on that board.</p>

                          {optimal && (
                            <>
                              <h3 className="h" style={{ marginTop: 18 }}>Best possible order</h3>
                              <p className="recap-sum">The best team score you could have built from these same six boards, slotted differently: <b>{(optimal.totalRating / totalWeight).toFixed(1)}</b> vs. your {result.score.toFixed(1)}.</p>
                              <RosterRows roster={SLOTS.map((s) => {
                                const a = optimal.slotAssignment[s];
                                const [tm, w] = a.key.split("|");
                                return { slot: s, ...a.player, rating: effectiveRating(s, a.player), board: `${TEAMS[tm][0]} ${WINDOWS[w][0]}–${WINDOWS[w][1]}` };
                              })} />
                              <p className="note recap-optimal">This assumes hindsight of all six boards you saw - it's what the ideal slot assignment would have scored, not a board you missed.</p>
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div className="frow" style={{ marginTop: 16 }}>
                      <button className="btn solid" onClick={doShare}>{share.state === "copied" ? "Copied to clipboard" : share.state === "shared" ? "Shared" : "Share result"}</button>
                      <button className="btn" onClick={restart}>Draft a new team</button>
                      <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>See the leaderboard</button>
                    </div>
                    {mode.kind === "free" && (
                      <p className="note">Send a friend the code <b>{mode.code}</b> and they'll draft the exact same six boards.</p>
                    )}
                    {share.state === "manual" && (
                      <>
                        <p className="note">Copying isn't allowed here, so select the text below and copy it.</p>
                        <textarea className="sharebox" readOnly value={share.text} onFocus={(e) => e.target.select()} />
                      </>
                    )}
                  </>
                )}
              </>
            )}
            </>
            )}
          </>
        )}

        {/* ---------------- ACCOUNT / PROFILE ---------------- */}
        {view === "profile" && authReady && !user && (
          <AuthPanel onAuthed={onAuthed} title="Your account"
            blurb="Log in to track your seasons, best lineup, and championships, and to appear on the leaderboard." />
        )}

        {view === "profile" && user && stats && (
          <>
            <div className="who">
              <span className="nm">{user}</span>
              <button className="linkbtn" onClick={logOut}>Log out</button>
            </div>

            {draftsOf(stats) === 0 ? (
              <div className="panel"><p style={{ margin: 0 }}>Play your first season to start your record.</p>
                <div style={{ marginTop: 10 }}><button className="btn solid" onClick={() => setView("play")}>Go to the draft</button></div></div>
            ) : (
              <>
                <div className="tiles">
                  <div className="tile"><div className="n">{draftsOf(stats)}</div><div className="l">Drafts{stats.dnf ? `, ${stats.dnf} DNF` : ""}</div></div>
                  <div className="tile"><div className="n">{stats.champs}</div><div className="l">Championships</div></div>
                  <div className="tile"><div className="n">{stats.perfect}</div><div className="l">Perfect seasons</div></div>
                  <div className="tile"><div className="n">{Math.round((100 * stats.playoffs) / draftsOf(stats))}%</div><div className="l">Made the playoffs</div></div>
                  <div className="tile"><div className="n">{stats.runs ? `${(stats.wins / stats.runs).toFixed(1)}–${(stats.losses / stats.runs).toFixed(1)}` : "–"}</div><div className="l">Average record, finished seasons</div></div>
                  <div className="tile"><div className="n">{stats.bestScore != null ? stats.bestScore.toFixed(1) : "–"}</div><div className="l">Best team score{myRank >= 0 ? `, #${myRank + 1} sitewide` : ""}</div></div>
                  <div className="tile"><div className="n">{stats.dailyStreak && (stats.dailyLast === todayKey() || nextStreak(stats, todayKey()) > 1) ? stats.dailyStreak : 0}</div>
                    <div className="l">Daily streak{stats.dailyBestStreak ? `, best ${stats.dailyBestStreak}` : ""}</div></div>
                </div>

                {stats.bestRun && (
                  <>
                    <h2 className="h">Best lineup</h2>
                    <p className="note" style={{ marginTop: 0 }}>{stats.bestRun.w}–{stats.bestRun.l}, team score {stats.bestRun.score.toFixed(1)}, {fmtDate(stats.bestRun.date)}. {stats.bestRun.outcome}.</p>
                    <RosterRows roster={stats.bestRun.roster} />
                  </>
                )}

                {stats.recent?.length > 0 && (
                  <>
                    <h2 className="h" style={{ marginTop: 20 }}>Recent drafts</h2>
                    <div className="recent">
                      {stats.recent.map((r, i) => r.dnf ? (
                        <div className="rr dnf" key={i}>
                          <span className="muted">{fmtDate(r.date)}</span>
                          <span className="rec2">DNF</span>
                          <span className="muted">Reset {r.picks ? `after ${r.picks} pick${r.picks > 1 ? "s" : ""}` : "before the first pick"}</span>
                          <span className="sc2 muted">–</span>
                        </div>
                      ) : (
                        <div className="rr" key={i}>
                          <span className="muted">{fmtDate(r.date)}</span>
                          <span className="rec2">{r.w}–{r.l}</span>
                          <span>{r.mode === "daily" ? "Daily: " : ""}{r.outcome}</span>
                          <span className="sc2 muted">{r.score.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ---------------- LEADERBOARD ---------------- */}
        {view === "board" && (
          <>
            {lb.loading && lb.top.length === 0 ? (
              <p className="muted">Loading the leaderboard…</p>
            ) : lb.error ? (
              <div className="panel"><p>The leaderboard didn't load.</p><button className="btn" onClick={loadLeaderboard}>Try again</button></div>
            ) : (
              <>
                <div className="dayhead">
                  <h2 className="h">Today's daily</h2>
                  <button className="linkbtn" onClick={loadDailyBoard} disabled={dailyBoard.loading}>{dailyBoard.loading ? "Loading…" : "Refresh"}</button>
                </div>
                {dailyBoard.rows.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>
                    {dailyBoard.loading ? "Loading today's scores…" : "No finished dailies yet today."}{" "}
                    {!dailyDone && <button className="linkbtn" onClick={() => { setView("play"); startDaily(); }}>Play today's daily</button>}
                  </p>
                ) : (
                  <table className="lb">
                    <thead><tr><th></th><th>Player</th><th className="r">Team score</th><th className="r">Record</th></tr></thead>
                    <tbody>
                      {dailyBoard.rows.slice(0, 10).map((q, i) => (
                        <tr key={i} className={user && q.username === user ? "me" : ""}>
                          <td className="rk">{i + 1}</td><td>{q.username}</td>
                          <td className="r">{q.score.toFixed(1)}</td><td className="r">{q.w}–{q.l}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <h2 className="h">Draft a friend's board</h2>
                <p className="note" style={{ marginTop: 0 }}>Enter a challenge code to get the exact same six boards they had.</p>
                <div className="frow" style={{ marginBottom: 18 }}>
                  <input className="inp" value={codeInput} maxLength={8} placeholder="Code, e.g. K3F9QZ" aria-label="Challenge code"
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && (setView("play"), startCode(codeInput))} />
                  <button className="btn solid" disabled={codeInput.trim().length < 4} onClick={() => { setView("play"); startCode(codeInput); }}>Draft this board</button>
                </div>

                <h2 className="h">All time</h2>
                <div className="tiles">
                  <div className="tile"><div className="n">{totals.players}</div><div className="l">Players</div></div>
                  <div className="tile"><div className="n">{totals.runs.toLocaleString()}</div><div className="l">Drafts</div></div>
                  <div className="tile"><div className="n">{totals.perfect}</div><div className="l">Perfect seasons</div></div>
                </div>

                {siteBest ? (
                  <div className="champion">
                    <div className="stripe" style={{ background: "var(--lamp)" }} />
                    <div className="pickno">Sitewide best team score</div>
                    <div className="sc led-wrap"><span className="led">{siteBest.bestScore.toFixed(1)}</span></div>
                    <div className="by">{siteBest.username}{siteBest.bestRun ? `, went ${siteBest.bestRun.w}–${siteBest.bestRun.l}` : ""}</div>
                    {siteBest.bestRun && <div className="ln">{siteBest.bestRun.roster.map((p) => `${p.name} (${p.season})`).join(", ")}</div>}
                  </div>
                ) : (
                  <div className="panel"><p style={{ margin: 0 }}>No scores yet. Finish a season while logged in to claim the top spot.</p></div>
                )}

                {lb.top.length > 0 && (
                  <>
                    <h2 className="h">Top 10</h2>
                    <table className="lb">
                      <thead><tr><th></th><th>Player</th><th className="r">Best score</th><th className="r">Best record</th><th className="r hide">Drafts</th><th className="r hide">20–0s</th></tr></thead>
                      <tbody>
                        {lb.top.map((q, i) => (
                          <tr key={q.id} className={q.id === myKey ? "me" : ""}>
                            <td className="rk">{i + 1}</td>
                            <td>{q.username}</td>
                            <td className="r">{q.bestScore.toFixed(1)}</td>
                            <td className="r">{q.bestRecord ? `${q.bestRecord.w}–${q.bestRecord.l}` : "–"}</td>
                            <td className="r hide">{draftsOf(q)}{q.dnf ? <span className="muted"> ({q.dnf} DNF)</span> : null}</td>
                            <td className="r hide">{q.perfect}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {authReady && !user && <p className="note">You're not on the leaderboard yet. <button className="linkbtn" onClick={() => setView("profile")}>Log in or create an account</button> and your seasons will count here.</p>}
                {user && myRank >= 10 && <p className="note">You're #{myRank + 1} with a best score of {stats.bestScore.toFixed(1)}.</p>}
                <button className="btn" onClick={loadLeaderboard} disabled={lb.loading}>{lb.loading ? "Refreshing…" : "Refresh"}</button>
              </>
            )}
          </>
        )}

        {/* ---------------- BUILD-A-PLAYER ---------------- */}
        {view === "buildplayer" && bap && (
          <>
            <h2 className="h">Build-a-player - {POS_NAME[bap.pos]}</h2>
            <p className="note" style={{ marginTop: 0 }}>Roll a real player, then take one of his stats for your build. {bap.remaining.length} categor{bap.remaining.length === 1 ? "y" : "ies"} left.</p>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{bap.roll.name}</h3>
              <p className="note" style={{ marginTop: 0 }}>{bap.roll.season} {teamLabel(bap.roll.team, bap.roll.season)}, {bap.roll.g} games</p>
              <div className="cells">
                {statCells(bap.roll).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
              </div>
              <div className="frow" style={{ marginTop: 10, flexWrap: "wrap" }}>
                {BUILD_CATEGORIES[bap.pos].filter(([k]) => bap.remaining.includes(k)).map(([k, label]) => (
                  <button key={k} className="btn solid" onClick={() => pickBapStat(k)}>Take his {label} ({bap.roll[k].toLocaleString()})</button>
                ))}
              </div>
            </div>
            {Object.keys(bap.filled).length > 0 && (
              <>
                <h3 className="h" style={{ marginTop: 18 }}>Locked in so far</h3>
                <div className="recap">
                  {Object.entries(bap.filled).map(([k, v]) => (
                    <div className="rc" key={k}><div className="bd">{BUILD_CATEGORIES[bap.pos].find(([ck]) => ck === k)[1]}</div><div className="tk">{v.toLocaleString()}</div></div>
                  ))}
                </div>
              </>
            )}
            <button className="btn" style={{ marginTop: 12 }} onClick={() => { setBap(null); setView("home"); }}>Cancel</button>
          </>
        )}

        {/* ---------------- STATS O/U ---------------- */}
        {view === "statsou" && souRound && (
          <>
            <h2 className="h">Stats O/U</h2>
            <p className="note" style={{ marginTop: 0 }}>
              Record: {souScore.right}–{souScore.wrong}. "Career" here means seasons that made our boards (best season per team per era) - a real slice of a career, not the whole thing.
            </p>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{souRound.name}</h3>
              <p className="note" style={{ marginTop: 0 }}>{POS_NAME[souRound.pos]} · played for {souRound.teams.join(", ")}</p>
              <p style={{ fontSize: 18, margin: "10px 0" }}>Career {souRound.statLabel}: <b>{souRound.line.toLocaleString()}</b></p>
              {!souRound.guess ? (
                <div className="frow">
                  <button className="btn solid" onClick={() => souGuess("over")}>Over</button>
                  <button className="btn solid" onClick={() => souGuess("under")}>Under</button>
                </div>
              ) : (
                <>
                  <p className={souRound.correct ? "ok" : "err"} style={{ margin: "0 0 10px" }}>
                    {souRound.correct ? "Correct!" : "Wrong."} Actual: {souRound.trueValue.toLocaleString()} {souRound.statLabel}.
                  </p>
                  <button className="btn solid" onClick={newSouRound}>Next player</button>
                </>
              )}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setView("home")}>Back to modes</button>
          </>
        )}
      </div>
    </div>
  );
}
