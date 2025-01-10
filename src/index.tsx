import { serveStatic } from '@hono/node-server/serve-static';
import { Button, Frog } from 'frog';
import { neynar } from 'frog/middlewares';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';

dotenv.config();

// بررسی کلیدهای API
const AIRSTACK_API_KEY = process.env.AIRSTACK_API_KEY;
if (!AIRSTACK_API_KEY) {
  console.error("AIRSTACK_API_KEY is not defined in the environment variables");
  throw new Error("AIRSTACK_API_KEY is missing");
}

const NEYNAR_API_KEY = "NEYNAR_FROG_FM";

export const app = new Frog({
  title: 'Degen Tips Risk',
  imageAspectRatio: '1:1',
  imageOptions: {
    fonts: [
      {
        name: 'Lilita One',
        weight: 400,
        source: 'google',
      },
      {
        name: 'Poppins',
        weight: 400,
        source: 'google',
      },
    ],
  },
  hub: {
    apiUrl: "https://hubs.airstack.xyz",
    fetchOptions: {
      headers: {
        "x-airstack-hubs": AIRSTACK_API_KEY,
      },
    },
  },
});

app.use(
  neynar({
    apiKey: NEYNAR_API_KEY,
    features: ["interactor"],
  })
);

app.use('/*', serveStatic({ root: './public' }));

// تابع واکشی اطلاعات points
async function fetchPoints(fid: string, season: string = "current"): Promise<string | null> {
  const apiUrl = `https://api.degen.tips/airdrop2/${season}/points?fid=${fid.toString()}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`API Error: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    return data?.[0]?.points || "0"; // مقدار points یا 0 اگر موجود نباشد
  } catch (error) {
    console.error("Error fetching points:", error);
    return null;
  }
}

// تابع واکشی اطلاعات تیپ‌ها
async function fetchTips(fid: string): Promise<any[]> {
  const apiUrl = `https://api.degen.tips/airdrop2/tips?fid=${fid.toString()}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`API Error: ${response.status} ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Error fetching tips:", error);
    return [];
  }
}

// تابع واکشی یوزرنیم با استفاده از Warpcast
async function fetchUsernameByFid(fid: string): Promise<string> {
  const apiUrl = `https://api.warpcast.com/v2/user?fid=${fid}`;
  try {
    const response = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      console.error(`Warpcast API Error for FID ${fid}: ${response.status} ${response.statusText}`);
      return "Unknown";
    }
    const data = await response.json();
    return data?.result?.user?.username || "Unknown"; // یوزرنیم یا Unknown
  } catch (error) {
    console.error(`Error fetching username for FID ${fid}:`, error);
    return "Unknown";
  }
}

async function getTopTippedUsers(tips: any[], maxUsers: number = 5): Promise<any[]> {
  const userTipData: Record<string, { fid: string; count: number; totalTipAmount: number }> = {};

  tips.forEach((tip) => {
    const recipientFid = tip.recipient_fid;
    const tipAmount = parseFloat(tip.tip_amount || "0");

    // اگر داده‌ای برای این FID موجود نیست، مقدار اولیه ایجاد کن
    if (!userTipData[recipientFid]) {
      userTipData[recipientFid] = { fid: recipientFid, count: 0, totalTipAmount: 0 };
    }

    // اضافه کردن مقدار تیپ‌ها و تعداد دفعات فقط برای این سیزن
    userTipData[recipientFid].count += tip.tip_count || 1; // شمارش تعداد دفعات تیپ
    userTipData[recipientFid].totalTipAmount += tipAmount; // جمع کردن مقدار تیپ‌ها
  });

  // مرتب‌سازی کاربران بر اساس مقدار کل تیپ‌های این سیزن
  const sortedUsers = Object.values(userTipData)
  .sort((a, b) => b.count - a.count)  // مرتب‌سازی نزولی
    .slice(0, maxUsers); // انتخاب تعداد کاربران مشخص‌شده

  // واکشی یوزرنیم‌ها برای کاربران
  const usersWithUsername = await Promise.all(
    sortedUsers.map(async (user) => {
      const username = await fetchUsernameByFid(user.fid);
      return { ...user, username };
    })
  );

  return usersWithUsername;
}


async function calculateTipsFromTopUsersToCurrentUser(
  topUsers: any[],
  currentFid: string
): Promise<any[]> {
  const tipDataForAllUsers = [];

  for (const user of topUsers) {
    const apiUrl = `https://api.degen.tips/airdrop2/tips?fid=${user.fid}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        console.error(`API Error for FID ${user.fid}: ${response.status} ${response.statusText}`);
        continue;
      }

      const tips = await response.json();
      if (!Array.isArray(tips)) {
        console.error(`Unexpected API response for FID ${user.fid}:`, tips);
        continue;
      }

      const filteredTips = tips.filter(
        (tip) => String(tip.recipient_fid) === String(currentFid)
      );

      const totalTipCount = filteredTips.length;
      const totalTipAmount = filteredTips.reduce(
        (sum, tip) => sum + parseFloat(tip.tip_amount || "0"),
        0
      );

      tipDataForAllUsers.push({
        userFid: user.fid,
        username: user.username,
        totalTipCount,
        totalTipAmount,
      });
    } catch (error) {
      console.error(`Error fetching tips for FID ${user.fid}:`, error);
    }
  }

  return tipDataForAllUsers; // داده‌ها را بازگردانید
}







app.frame('/', async (c) => {
  const fid = c.req.query('fid') || (c.var as any).interactor?.fid || "?";
  const username = c.req.query('username') || (c.var as any).interactor?.username || "Unknown";
  const pfpUrl = c.req.query('pfpUrl') || (c.var as any).interactor?.pfpUrl || "";
  const points = c.req.query('points') || (fid !== "?" ? await fetchPoints(fid) : null);

  console.log("FID:", fid);
  console.log("Username:", username);
  console.log("PFP URL:", pfpUrl);
  console.log("Points:", points);

  // دریافت اطلاعات تیپ‌ها و استخراج ۵ نفر برتر
  let topUsers: any[] = [];
  let tipDataForAllUsers: any[] = [];
  if (fid !== "?") {
    const tips = await fetchTips(fid);
    topUsers = await getTopTippedUsers(tips);

    tipDataForAllUsers = await calculateTipsFromTopUsersToCurrentUser(topUsers, fid);
    
  }


  tipDataForAllUsers.forEach((data) => {
    console.log(
      `From User FID: ${data.userFid}, Username: ${data.username}, Count: ${data.totalTipCount}, Amount: ${data.totalTipAmount}`
    );
  });

  // چاپ در ترمینال
  console.log(`Top 5 Tipped Users by ${username} (FID: ${fid}):`);
  topUsers.forEach((user, index) => {
    console.log(
      `${index + 1}. Username: ${user.username}, FID: ${user.fid}, Total Tips: ${user.totalTipAmount}`
    );
  });
  //console.log('Tip Data:', tipDataForAllUsers);


   // بررسی وضعیت برای نفر اول
   let statusMessage = "";
   let statusColor = "";
 
   if (topUsers.length > 0 && tipDataForAllUsers.length > 0) {
     const firstUserCount = topUsers[0].count || 0;
     const firstUserTotalTipCount = tipDataForAllUsers[0].totalTipCount || 0;
 
     if (firstUserCount <= 12 && firstUserTotalTipCount <= 12) {
       statusMessage = "You are in a good state";
       statusColor = "#70e000";
     } else if (firstUserCount <= 14 && firstUserTotalTipCount <= 14) {
       statusMessage = "You are in a warning state";
       statusColor = "#deff0a";
     } else {
       statusMessage = "You are in a dangerous state";
       statusColor = "#ff0000";
     }
   }

   function generateShareUrl(fid: string, username: string, pfpUrl: string, points: string | null): string {
    const baseUrl = "https://0a7d-79-127-240-45.ngrok-free.app";
    const url = `${baseUrl}?fid=${encodeURIComponent(fid)}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}&points=${encodeURIComponent(points || "0")}`;
    console.log("Generated Share URL:", url);
    return url;
  }
  
  function generateWarpcastComposeUrl(shareUrl: string): string {
    const text = "Check your Degen Tips Risk!\n\nFrame By @jeyloo.eth"; // متن چند خطی با \n
    return `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(shareUrl)}`;
  }
  
  
  const commentText = "Perfect and useful!\n 10 $DEGEN";
  const postHash = "0x74083db5f0d35f9cb40f360c531f0560691f1ac0"; // هش کست موردنظر
  const commentUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(commentText)}&parentCastHash=${postHash}`;
  

console.log("Comment Text:", commentText);
console.log("Post Hash:", postHash);
console.log("Generated Comment URL:", commentUrl);

  const shareUrl = generateShareUrl(fid, username, pfpUrl, points);


  return c.res({
    image: (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* تصویر پس‌زمینه کامل */}
        <img
          src="https://i.imgur.com/qM7Ta8m.png"
          alt="Full Frame Background"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            position: 'absolute',
            zIndex: -1,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '43%',
            color: 'white',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* یوزرنیم کاربر */}
          <p
            style={{
              fontSize: '36px',
              fontWeight: 'bold',
              fontFamily: "'Lilita One', sans-serif",
              color: 'cyan',
              marginBottom: '5px',
            }}
          >
            {username}
          </p>
          {/* FID کاربر */}
          <p
            style={{
              fontSize: '18px',
              fontWeight: 'normal',
              fontFamily: "'Poppins', sans-serif",
              color: 'white',
              marginTop: '0px',
            }}
          >
            {fid}
          </p>
          {/* Points */}
          {points && (
            <p
              style={{
                fontSize: '35px',
                top: '16.5%',
                fontWeight: 'bold',
                fontFamily: "'Lilita One', sans-serif",
                color: 'lightgreen',
                marginTop: '10px',
              }}
            >
              Points: {points}
            </p>
          )}
        </div>
                 {/* نمایش اطلاعات یوزرنیم‌ها */}
        <div
          style={{
            position: 'absolute',
            top: '47.5%',
            left: '50.5%',
            transform: 'translate(-50%, 0)',
            color: 'white',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px', // فاصله بین آیتم‌ها
          }}
        >
          {topUsers.map((user) => (
            <p
              key={user.fid}
              style={{
                color: "#90caf9",
                fontSize: '25px',
                fontWeight: '100',
                fontFamily: "'Lilita One', sans-serif",
                margin: '0',
              }}
            >
              {user.username}
            </p>
          ))}
        </div>

{/* نمایش پیام وضعیت */}
<div
          style={{
            position: 'absolute',
            top: '85%', // موقعیت دلخواه برای پیام
            left: '50%',
            transform: 'translate(-50%, 0)',
            color: statusColor,
            fontSize: '36px',
            fontWeight: 'bold',
            fontFamily: "'Lilita One', sans-serif",
            textAlign: 'center',
          }}
        >
          {statusMessage}
        </div>

{/* نمایش totalTipCount (تعداد کل دفعات تیپ) */}
<div
  style={{
    position: 'absolute',
    top: '48%',
    left: '38%',
    transform: 'translate(-50%, 0)',
    color: 'white',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '13px',
  }}
>
  {tipDataForAllUsers && tipDataForAllUsers.length > 0 ? (
    tipDataForAllUsers.map((data) => (
      <p
        key={data.userFid + '-totalTipCount'}
        style={{
          color: '#9ef01a',
          fontSize: '20px',
          fontWeight: '400',
          fontFamily: "Poppins, sans-serif",
          margin: '0',
        }}
      >
        {data.totalTipCount || '0'}
      </p>
    ))
  ) : (
    <p
      style={{
        color: '#ff8c00',
        fontSize: '20px',
        fontWeight: '400',
        fontFamily: "Poppins, sans-serif",
        margin: '0',
      }}
    >
      
    </p>
  )}
</div>


{/* نمایش totalTipAmount (مجموع مقدار تیپ‌ها) */}
<div
  style={{
    position: 'absolute',
    top: '48%', // تنظیم موقعیت عمودی
    left: '29%', // موقعیت ستون جدید
    transform: 'translate(-50%, 0)',
    color: 'white',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px', // فاصله بین آیتم‌ها
  }}
>
  {tipDataForAllUsers && tipDataForAllUsers.length > 0 ? (
    tipDataForAllUsers.map((data) => (
      <p
        key={data.userFid + '-totalTipAmount'}
        style={{
          color: '#f39c12', // رنگ دلخواه
          fontSize: '20px',
          fontWeight: '400',
          fontFamily: "Poppins, sans-serif",
          margin: '0',
        }}
      >
        {data.totalTipAmount || '0'} {/* مقدار totalTipAmount */}
      </p>
    ))
  ) : (
    <p
      style={{
        color: '#f39c12',
        fontSize: '20px',
        fontWeight: '400',
        fontFamily: "Poppins, sans-serif",
        margin: '0',
      }}
    >
     
    </p>
  )}
</div>



        {/* نمایش تعداد دفعات تیپ */}
        <div
          style={{
            position: 'absolute',
            top: '48%',
            left: '61%', // تنظیم موقعیت جداگانه برای ستون تعداد دفعات
            transform: 'translate(-50%, 0)',
            color: 'white',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '13px', // فاصله بین آیتم‌ها
          }}
        >
          {topUsers.map((user) => (
            <p
              key={user.fid + '-count'}
              style={{
                color: '#ff0054',
                fontSize: '20px',
                fontWeight: '100',
                fontFamily: "'Poppins', sans-serif",
                margin: '0',
              }}
            >
              {user.count}
            </p>
          ))}
        </div>

     {/* نمایش مقدار تیپ داده‌شده */}
     <div
          style={{
            position: 'absolute',
            top: '48%',
            left: '70%', // موقعیت ستون مقدار تیپ
            transform: 'translate(-50%, 0)',
            color: 'white',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
          }}
        >
          {topUsers.map((user) => (
            <p
              key={user.fid + '-totalAmount'}
              style={{
                color: '#ff0054',
                fontSize: '20px',
                fontWeight: '400',
                fontFamily: "Poppins, sans-serif",
                margin: '0',
              }}
            >
              {user.totalTipAmount || '0'} {/* مقدار کل تیپ داده‌شده */}
            </p>
          ))}
        </div>

        {/* تصویر پروفایل */}
        {pfpUrl && (
          <img
            src={pfpUrl}
            alt="Profile Picture"
            style={{
              width: '145px',
              height: '145px',
              borderRadius: '50%',
              position: 'absolute',
              top: '17%',
              left: '67.7%',
              transform: 'translate(-50%, -50%)',
              border: '3px solid white',
            }}
          />
        )}
      </div>
    ),
    intents: [
      <Button value="mystate">My State</Button>,
      <Button.Link href={generateWarpcastComposeUrl(shareUrl)}>Share</Button.Link>,
      <Button.Link href={commentUrl}>Tip Me </Button.Link>,
      <Button.Link href="https://warpcast.com/jeyloo.eth">Jeyloo.eth</Button.Link>,


    ],
  });
});


// فعال‌سازی سرور
const port = process.env.PORT || 3000;
serve(app);
console.log(`Server is running on port ${port}`);
