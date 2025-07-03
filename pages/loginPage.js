class loginPage {
    constructor(page) {
        this.page = page
        this.username = "(//input[@id='email1'])[1]";
        this.password = "(//input[@id='password1'])[1]"
        this.signin = "button[type='submit']";
    }

    async loginnToApplication() {
        await this.page.fill(this.username, "admin@email.com")
        await this.page.fill(this.password, "admin@123")
        await this.page.click(this.signin)
    }


}

module.exports = loginPage