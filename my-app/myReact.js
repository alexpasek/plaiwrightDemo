function MyButton() {
    return <button > I 'm a button</button>;
};




//here whow we use export 
export default function myApp(){

return (<div> 

<h1>Welcome to my app</h1>

<MyButton />



</div>)


}

//jsx tags 
function aboutPage(){
    return (
      <>
        <h1>About page</h1>
        <p>
          Hello there <br /> how doyou do
        </p>

      </>
    );
}
// Specify class 
<img alt = "description of " className = "avatar"/>;

const user = {
  name:"admin"
}
const add = () => {
return <h1>{user.name}</h1>
}



let content1;
if (isLoggedIn){
  content1=<AdminPanel/>
}else{
  content1= <LoginForm/>
}return(
  <div >{content1}</div>
);

const products = [
  { title: "Cabbage", id: 1 },
  { title: "Garlic", id: 2 },
  { title: "Apple", id: 3 },
];
const listItems = products.map((product) => (
  
    <li key = {product.id}> {product.title}</li>
  
));
return(<ul> {listItems} </ul>);
import { count } from "console";
import { useState } from "react"; 


function MyButton(){
  const [value,setvalue ]= useState(0);

function handleClick(){
setvalue(value+10)
}
return (<button onClick={handleClick} >  click {value} how many times 
  
  
  
  </button>);

}
