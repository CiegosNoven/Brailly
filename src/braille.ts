// Illustrative uncontracted English mapping for the simulator only.
// Hardware translation is delegated to BRLTTY or the user's screen reader.
const alphabet=[1,3,9,25,17,11,27,19,10,26,5,7,13,29,21,15,31,23,14,30,37,39,58,45,61,53];
const punctuation:Record<string,number>={' ':0,',':2,';':6,':':18,'.':50,'·':50,'!':22,'?':38,'-':36,'/':12,"'":4,'(':54,')':54,'°':52};
export function toBraille(text:string):number[]{const dots:number[]=[];let number=false;for(const char of text){if(/[0-9]/.test(char)){if(!number)dots.push(60);number=true;dots.push(alphabet['1234567890'.indexOf(char)]);continue;}number=false;if(/[A-Z]/.test(char))dots.push(32);const i=char.toLowerCase().charCodeAt(0)-97;if(i>=0&&i<26)dots.push(alphabet[i]);else dots.push(punctuation[char]??63);}return dots;}
