const request = require('request');
const getHrefs = require('get-hrefs');
var prompt = require('prompt-sync')();
var puppeteer = require('puppeteer');
const fs = require('fs');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getArticleLinks(html) {
    var linkArray = getHrefs(html);
    var links = [];
    for (var count = 0; count < linkArray.length; count++) {
        if (linkArray[count].split('wsj.com/')[1] && linkArray[count].split('wsj.com/')[1].split('/')[0] == 'articles') {
            links.push(linkArray[count].slice(0, 2) === '//' ? linkArray[count].split('?')[0].replace('//', 'https://') : linkArray[count].split('?')[0]);
        }
    }
    return links;
}

function getNewsLinks(html) {
    var linkArray = getHrefs(html);
    var links = [];
    for (var count = 0; count < linkArray.length; count++) {
        if (linkArray[count].split('wsj.com/')[1] && linkArray[count].split('wsj.com/')[1].split('/')[0] == 'news') {
            links.push(linkArray[count].slice(0, 2) === '//' ? linkArray[count].split('?')[0].replace('//', 'https://') : linkArray[count].split('?')[0]);
        }
    }
    return links;
}
var bigNewsArray = [], queue = 0, queueMax = 200, doneCounter = 1, realCallback;
//Recursive function for scouring every single news link, looking for more news links
function getNewsRecursive(link, callback){
    if(!realCallback) realCallback = callback;
    bigNewsArray.push(link);
    
    var recursiveFunctionCallback = function(){
        doneCounter--;
        if(doneCounter === 0){
            realCallback();
        }
    };
    queue++;
    request(link, function(err, response, body){
        if(err){
            console.log('Request recursive error at url '+link+': '+err);
            process.exit(1);
        }
        var newsLinks = getNewsLinks(body).filter(e=>{return !bigNewsArray.includes(e)});
        if(!newsLinks.length){
            recursiveFunctionCallback();
            return;
        }
        // console.log(newsLinks.length);process.exit()
        queue--;
        newsLinks.forEach(async function(newsLink){
            doneCounter++;
            if(queue < queueMax){
                getNewsRecursive(newsLink, recursiveFunctionCallback);
            }else{
                await (function(){
                    return new Promise((resolve)=>{
                        var loopInterval = setInterval(()=>{
                            clearInterval(loopInterval);
                            resolve();
                        }, 1);
                    });
                })();
                getNewsRecursive(newsLink, recursiveFunctionCallback);
            }
        });
        doneCounter--;
    });
}
function getArticleRecursive(link, realCallback){
    var bigArticlesArray = [], queue = 0, queueMax = 200, doneCounter = 1;
    function recursive(link){
        bigArticlesArray.push(link);
        
        var recursiveFunctionCallback = function(){
            doneCounter--;
            if(doneCounter === 0){
                realCallback(bigArticlesArray.slice(1));
            }
        };
        queue++;
        request(link, function(err, response, body){
            if(err){
                console.log('Request recursive error at url '+link+': '+err);
                process.exit(1);
            }
            var articleLinks = getArticleLinks(body).filter(e=>{return !bigArticlesArray.includes(e)});
            if(!articleLinks.length){
                recursiveFunctionCallback();
                return;
            }
            // console.log(newsLinks.length);process.exit()
            queue--;
            articleLinks.forEach(async function(articleLink){
                doneCounter++;
                if(queue < queueMax){
                    recursive(articleLink, recursiveFunctionCallback);
                }else{
                    await (function(){
                        return new Promise((resolve)=>{
                            var loopInterval = setInterval(()=>{
                                clearInterval(loopInterval);
                                resolve();
                            }, 1);
                        });
                    })();
                    recursive(articleLink, recursiveFunctionCallback);
                }
            });
            doneCounter--;
        });
    }
    recursive(link);
}

function getData(){
    return new Promise((resolve)=>{
        var database = [];
        console.log('Getting all news links');
        getNewsRecursive('https://www.wsj.com', async function(){
            console.log('Done getting all news links. Now getting article links. # of news: '+bigNewsArray.length);
            for(var c = 0; c < bigNewsArray.length; c++){
                database = database.concat(await new Promise((resolve)=>{
                    getArticleRecursive(bigNewsArray[c], resolve);
                }));
                printProgress('Done iteration number '+(c+1)+' out of '+bigNewsArray.length);
            }
            console.log('\n# of articles: '+database.length);
            fs.writeFileSync('articleList.json', JSON.stringify(database, null, 3), 'utf8');
            resolve(database);
        });
    });
}

function printProgress(progress) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(progress);
}


// Main
(async() => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    //Login
    await page.goto('https://accounts.wsj.com/login');
    var email = prompt('Enter your email: ');
    var pass = prompt.hide('Enter your password: ');
    await page.evaluate(function(email, pass) {
        document.getElementById('username').value = email;
        document.getElementById('password').value = pass;
        document.getElementsByClassName('solid-button basic-login-submit')[0].click();
    }, email, pass);
    sleep(4000);
    try {
        if (await page.evaluate(() => { return document.getElementsByClassName('username-error-container')[0].style.display }) !== 'none') {
            console.log('Login failed!');
            browser.close();
            process.exit(1);
        }
    }
    catch (e) {}
    await page.waitForNavigation();
    var loginCookies = await page.cookies('https://wsj.com');
    await page.close();

    async function getPDF(url, path) {
        var tempContext = await browser.createIncognitoBrowserContext();
        var tempPage = await tempContext.newPage();
        tempPage.setDefaultNavigationTimeout(0);
        tempPage.setDefaultTimeout(0);
        tempPage.setCookie(...loginCookies);
        await tempPage.goto(url, {
            waitUntil: 'networkidle2',
        });
        var pdf = await tempPage.pdf({ margin: { top: "0.4in", right: "0.4in", bottom: "0.4in", left: "0.4in" } }); // {format: 'A4'}
        fs.writeFileSync(`${path}/${(await tempPage.title()).replace(/\//g, '(slash)')}.pdf`, pdf);
        await tempPage.close();
        await tempContext.close();
    }
    
    
    //Get article list
    var articleList = JSON.parse(fs.readFileSync('articleList.json', 'utf8'));//await getData();

    console.log('Saving all articles to PDF');
    //Download articles
    for (var articleCount = 0; articleCount < articleList.length; articleCount++) {
        await getPDF(articleList[articleCount], 'scrape_every_corner_pdfs');
        printProgress(`Printed ${articleCount+1} out of ${articleList.length} articles`);
    }

    await browser.close();
})();
